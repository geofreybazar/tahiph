import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createMeasurementRecordSchema, MEASUREMENT_LABELS, MEASUREMENT_UNITS } from '@tahi/shared';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Field, selectClass, textareaClass } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useTenantAccess } from '@/lib/use-tenant-access';

interface MeasurementRecord {
  id: string;
  takenOn: string;
  unit: string;
  notes: string | null;
  recordedBy: { email: string; fullName: string | null };
  values: { id: string; key: string; label: string | null; value: string }[];
}

interface Profile {
  id: string;
  personName: string;
  notes: string | null;
  client: { id: string; fullName: string };
  records: MeasurementRecord[];
}

const labelOf = ({ key, label }: { key: string; label: string | null }) =>
  label ?? MEASUREMENT_LABELS[key as keyof typeof MEASUREMENT_LABELS] ?? key;

export function ProfilePage() {
  const { id = '' } = useParams();
  const { tenantId } = useTenantAccess();
  const profile = useQuery({
    queryKey: ['measurement-profile', tenantId, id],
    queryFn: () => apiFetch<Profile>(`/measurement-profiles/${id}`, { tenantId }),
  });

  if (profile.isPending) return <p>Loading…</p>;
  if (profile.isError) return <FormError error={profile.error} />;
  const { data } = profile;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="break-words text-2xl font-semibold">{data.personName}</h1>
        <Link
          className="text-sm underline-offset-4 hover:underline"
          to={`/clients/${data.client.id}`}
        >
          {data.client.fullName}
        </Link>
      </div>
      <AddRecord profileId={id} tenantId={tenantId} />
      <Card>
        <CardHeader>
          <CardTitle>Fitting history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.records.length === 0 && (
            <p className="text-sm text-muted-foreground">No fittings recorded yet.</p>
          )}
          {data.records.map((record) => (
            <section key={record.id} className="space-y-2 rounded-md border p-3">
              <h2 className="font-medium">
                {formatDate(record.takenOn)} ({record.unit})
              </h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                {record.values.map((value) => (
                  <div key={value.id}>
                    <dt className="break-words text-muted-foreground">{labelOf(value)}</dt>
                    <dd>{value.value}</dd>
                  </div>
                ))}
              </dl>
              {record.notes && (
                <p className="whitespace-pre-wrap break-words text-sm">{record.notes}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Recorded by {record.recordedBy.fullName ?? record.recordedBy.email}
              </p>
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AddRecord({ profileId, tenantId }: { profileId: string; tenantId: string }) {
  const queryClient = useQueryClient();
  const [takenOn, setTakenOn] = useState('');
  const [unit, setUnit] = useState<(typeof MEASUREMENT_UNITS)[number]>('in');
  const [notes, setNotes] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<{ label: string; value: string }[]>([]);
  const [invalid, setInvalid] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (body: unknown) =>
      apiFetch(`/measurement-profiles/${profileId}/records`, { tenantId, method: 'POST', body }),
    onSuccess: () => {
      setValues({});
      setCustom([]);
      setNotes('');
      void queryClient.invalidateQueries({
        queryKey: ['measurement-profile', tenantId, profileId],
      });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = createMeasurementRecordSchema.safeParse({
      takenOn,
      unit,
      notes,
      values: [
        ...Object.entries(values)
          .filter(([, value]) => value.trim())
          .map(([key, value]) => ({ key, value: value.trim() })),
        ...custom
          .filter((row) => row.label.trim() || row.value.trim())
          .map((row, index) => ({
            key: `custom_${index + 1}`,
            label: row.label,
            value: row.value.trim(),
          })),
      ],
    });
    if (!parsed.success) {
      setInvalid(
        'Enter the date and at least one measurement. Values are positive numbers like 34.5, and custom measurements need a name.',
      );
      return;
    }
    setInvalid(null);
    add.mutate(parsed.data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a fitting</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          A saved fitting can't be edited. To correct one, record a new one.
        </p>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <div className="flex flex-wrap gap-3">
            <Field id="taken-on" label="Date">
              <Input
                id="taken-on"
                type="date"
                value={takenOn}
                onChange={(e) => setTakenOn(e.target.value)}
              />
            </Field>
            <Field id="unit" label="Unit">
              <select
                id="unit"
                className={`${selectClass} block`}
                value={unit}
                onChange={(e) => setUnit(e.target.value as typeof unit)}
              >
                <option value="in">inches</option>
                <option value="cm">centimetres</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(MEASUREMENT_LABELS).map(([key, label]) => (
              <Field key={key} id={`m-${key}`} label={label}>
                <Input
                  id={`m-${key}`}
                  inputMode="decimal"
                  value={values[key] ?? ''}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          {custom.map((row, index) => (
            <div key={index} className="flex flex-wrap gap-3">
              <Field id={`c-label-${index}`} label="Measurement name">
                <Input
                  id={`c-label-${index}`}
                  value={row.label}
                  onChange={(e) =>
                    setCustom(
                      custom.map((c, i) => (i === index ? { ...c, label: e.target.value } : c)),
                    )
                  }
                />
              </Field>
              <Field id={`c-value-${index}`} label="Value">
                <Input
                  id={`c-value-${index}`}
                  inputMode="decimal"
                  value={row.value}
                  onChange={(e) =>
                    setCustom(
                      custom.map((c, i) => (i === index ? { ...c, value: e.target.value } : c)),
                    )
                  }
                />
              </Field>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCustom([...custom, { label: '', value: '' }])}
          >
            Add another measurement
          </Button>
          <Field id="record-notes" label="Notes">
            <textarea
              id="record-notes"
              rows={2}
              className={textareaClass}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          {invalid && (
            <p role="alert" className="text-sm text-destructive">
              {invalid}
            </p>
          )}
          <FormError error={add.error} />
          <Button type="submit" disabled={add.isPending}>
            Save fitting
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
