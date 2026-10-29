import { useMemo, useState } from 'react';
import { catalogApi, type Category, type Service, type ServiceInput } from '../../api';
import { Async, Button, Card, Check, Empty, ErrorBox, Field, Modal, MoneyInput, PageHeader, Tabs } from '../../components/ui';
import { humanize, le } from '../../lib/format';
import { useApi, useDebounced, type AsyncState } from '../../lib/hooks';
import { useToast } from '../../lib/toast';

export default function Catalog() {
  const [tab, setTab] = useState<'services' | 'categories'>('services');
  const cats = useApi(() => catalogApi.categories(), []);
  return (
    <>
      <PageHeader title="Catalog" subtitle="Trades and the jobs customers can book, with base prices before peak pricing and provider overrides." />
      <Tabs
        tabs={[
          { id: 'services', label: 'Services' },
          { id: 'categories', label: 'Categories' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'services' ? <Services categories={cats.data ?? []} /> : <Categories state={cats} />}
    </>
  );
}

function Categories({ state }: { state: AsyncState<Category[]> }) {
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const flat = (state.data ?? []).flatMap((c) => [c, ...c.children]);
  return (
    <>
      <div className="filters">
        <Button variant="primary" onClick={() => setEditing('new')}>
          + New category
        </Button>
        <span className="small muted">Deactivated categories are hidden from this list and from the apps.</span>
      </div>
      <Card flush>
        <Async state={state} empty={<Empty title="No categories" />}>
          {() => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Slug</th>
                    <th>Krio name</th>
                    <th>Icon</th>
                    <th className="right">Order</th>
                    <th className="right">Services</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {flat.map((c) => (
                    <tr key={c.id}>
                      <td className="strong">
                        {c.parent_id ? '— ' : ''}
                        {c.name}
                      </td>
                      <td className="mono small">{c.slug}</td>
                      <td>{c.name_kri ?? <span className="muted">–</span>}</td>
                      <td className="small">{c.icon ?? '–'}</td>
                      <td className="right num">{c.sort_order}</td>
                      <td className="right num">{c.service_count}</td>
                      <td className="right">
                        <Button size="sm" onClick={() => setEditing(c)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      </Card>
      {editing && (
        <CategoryForm
          cat={editing === 'new' ? undefined : editing}
          roots={state.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      )}
    </>
  );
}

function CategoryForm({ cat, roots, onClose, onSaved }: { cat?: Category; roots: Category[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(cat?.name ?? '');
  const [slug, setSlug] = useState(cat?.slug ?? '');
  const [nameKri, setNameKri] = useState(cat?.name_kri ?? '');
  const [icon, setIcon] = useState(cat?.icon ?? '');
  const [parentId, setParentId] = useState(cat?.parent_id ?? '');
  const [sortOrder, setSortOrder] = useState(cat?.sort_order ?? 0);
  const [active, setActive] = useState(cat?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const ok = name.trim().length >= 2 && /^[a-z0-9-]+$/.test(slug);

  const save = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      const body = { name: name.trim(), slug, nameKri: nameKri.trim() || undefined, icon: icon.trim() || undefined, sortOrder, active };
      if (cat) await catalogApi.updateCategory(cat.id, body);
      else await catalogApi.createCategory({ ...body, parentId: parentId || null });
      toast.success(cat ? 'Category saved' : 'Category created');
      onSaved();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={cat ? `Edit ${cat.name}` : 'New category'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!ok} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name">
          <input
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!cat) setSlug(e.target.value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
            }}
          />
        </Field>
        <Field label="Slug" hint="Lowercase letters, digits and -">
          <input className="input mono" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
        </Field>
        <Field label="Krio name">
          <input className="input" value={nameKri} onChange={(e) => setNameKri(e.target.value)} placeholder="optional" />
        </Field>
        <Field label="Icon" hint="Icon key used by the apps, e.g. bolt">
          <input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} />
        </Field>
        <Field label="Parent" hint={cat ? 'The parent cannot be changed after creation' : undefined}>
          <select className="select" value={parentId} disabled={!!cat} onChange={(e) => setParentId(e.target.value)}>
            <option value="">None (top level)</option>
            {roots
              .filter((r) => r.id !== cat?.id)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Sort order">
          <input className="input num" type="number" value={sortOrder} onChange={(e) => setSortOrder(Math.round(Number(e.target.value)))} />
        </Field>
        <div className="full">
          <Check checked={active} onChange={setActive} label="Active (shown in the apps)" />
        </div>
        {err !== undefined && (
          <div className="full">
            <ErrorBox error={err} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function Services({ categories }: { categories: Category[] }) {
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const list = useApi(() => catalogApi.services({ categoryId: categoryId || undefined, q: q || undefined }), [categoryId, q]);
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const flat = useMemo(() => categories.flatMap((c) => [c, ...c.children]), [categories]);

  return (
    <>
      <div className="filters">
        <Button variant="primary" onClick={() => setEditing('new')} disabled={!flat.length}>
          + New service
        </Button>
        <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {flat.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input className="input" placeholder="Search services" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Card flush>
        <Async state={list} empty={<Empty title="No services match" />}>
          {(rows) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Category</th>
                    <th className="right">Base price</th>
                    <th>Unit</th>
                    <th className="right">Duration</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span className="strong">{s.name}</span>
                        {s.description && <div className="cell-sub">{s.description}</div>}
                      </td>
                      <td>{s.category_name}</td>
                      <td className="right num strong">{le(s.base_price_minor)}</td>
                      <td className="small">{s.price_unit === 'per_unit' ? `per ${s.unit_label ?? 'unit'}` : humanize(s.price_unit)}</td>
                      <td className="right num">{s.duration_minutes} min</td>
                      <td className="right">
                        <Button size="sm" onClick={() => setEditing(s)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      </Card>
      {editing && (
        <ServiceForm
          svc={editing === 'new' ? undefined : editing}
          categories={flat}
          defaultCategory={categoryId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </>
  );
}

function ServiceForm({ svc, categories, defaultCategory, onClose, onSaved }: { svc?: Service; categories: Category[]; defaultCategory: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<ServiceInput>({
    categoryId: svc?.category_id ?? (defaultCategory || categories[0]?.id || ''),
    name: svc?.name ?? '',
    nameKri: svc?.name_kri ?? '',
    description: svc?.description ?? '',
    basePriceMinor: svc?.base_price_minor ?? 0,
    priceUnit: svc?.price_unit ?? 'fixed',
    unitLabel: svc?.unit_label ?? '',
    durationMinutes: svc?.duration_minutes ?? 60,
    active: svc?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const set = <K extends keyof ServiceInput>(k: K, v: ServiceInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const ok = f.name.trim().length >= 2 && f.categoryId && f.durationMinutes > 0 && (f.priceUnit !== 'per_unit' || f.unitLabel?.trim());

  const save = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      const body: ServiceInput = {
        ...f,
        name: f.name.trim(),
        nameKri: f.nameKri?.trim() || undefined,
        description: f.description?.trim() || undefined,
        unitLabel: f.priceUnit === 'fixed' ? undefined : f.unitLabel?.trim() || undefined,
      };
      if (svc) await catalogApi.updateService(svc.id, body);
      else await catalogApi.createService(body);
      toast.success(svc ? 'Service saved' : 'Service created');
      onSaved();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={svc ? `Edit ${svc.name}` : 'New service'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!ok} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name">
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Ceiling fan installation" />
        </Field>
        <Field label="Category">
          <select className="select" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" className="full">
          <textarea className="textarea" value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Krio name">
          <input className="input" value={f.nameKri} onChange={(e) => set('nameKri', e.target.value)} placeholder="optional" />
        </Field>
        <Field label="Base price" hint="Before peak pricing">
          <MoneyInput value={f.basePriceMinor} onChange={(v) => set('basePriceMinor', v ?? 0)} allowEmpty={false} />
        </Field>
        <Field label="Priced">
          <select className="select" value={f.priceUnit} onChange={(e) => set('priceUnit', e.target.value as ServiceInput['priceUnit'])}>
            <option value="fixed">Fixed price per job</option>
            <option value="hourly">Per hour</option>
            <option value="per_unit">Per unit</option>
          </select>
        </Field>
        {f.priceUnit !== 'fixed' && (
          <Field label="Unit label" hint="e.g. socket, room, m²">
            <input className="input" value={f.unitLabel} onChange={(e) => set('unitLabel', e.target.value)} />
          </Field>
        )}
        <Field label="Typical duration (minutes)">
          <input className="input num" type="number" min={1} value={f.durationMinutes} onChange={(e) => set('durationMinutes', Math.round(Number(e.target.value)))} />
        </Field>
        <div className="full">
          <Check checked={!!f.active} onChange={(v) => set('active', v)} label="Active (bookable)" />
        </div>
        {err !== undefined && (
          <div className="full">
            <ErrorBox error={err} />
          </div>
        )}
      </div>
    </Modal>
  );
}
