"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PhotoCapture, TextArea } from "@galaxy-farm/ui";
import { animalSchema, type Animal, type Ulid } from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";
import { useAttachPhotos, type PhotoIntake } from "@/lib/photos/use-photos";

import {
  DetailsForm,
  errorText,
  forCount,
  KindSwitch,
  todayValue,
  whoLine,
  type DetailsProps,
} from "./log-parts";

/**
 * A note or a photo, on one animal or several.
 *
 * A note goes where an animal's notes already live — the `notes` field her
 * page shows and the herd editor writes — as a dated line added to the top,
 * so what was there stays. A photo goes through the shared photo intake
 * (`useAttachPhotos`): bytes queued on the device first, then the
 * `Attachment` record, so it works in a pen with no signal. Several animals
 * get one attachment each, pointing at their own copy in the queue.
 */

const SWITCH = [
  { kind: "note", label: "Note" },
  { kind: "photo", label: "Photo" },
] as const;

export function NotePhotoDetails(props: DetailsProps) {
  return props.kind === "photo" ? <PhotoForm {...props} /> : <NoteForm {...props} />;
}

function NoteForm({ propertyId, actorId, kind, onKind, animals, onSaved }: DetailsProps) {
  const api = useMutations<Animal>("animals", "animals", animalSchema, propertyId, actorId);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(undefined);
    const line = text.trim();
    if (line === "") {
      setError("Write the note");
      return;
    }

    setBusy(true);
    try {
      let saved = 0;
      for (const animal of animals) {
        // Newest first, dated, and added to what is there rather than over it.
        const entry = `${todayValue()}: ${line}`;
        const notes =
          animal.notes === undefined || animal.notes.trim() === ""
            ? entry
            : `${entry}\n${animal.notes}`;
        const result = await api.update(animal.id, { notes } as Partial<Animal>);
        if (!result.ok) {
          setError(
            `${saved === 0 ? "" : `Saved for ${forCount(saved)}, then: `}${errorText(result.error)}`,
          );
          return;
        }
        saved += 1;
      }
      onSaved({ headline: `Saved for ${forCount(saved)}`, detail: "In each animal's notes." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailsForm
      title="Note"
      who={whoLine(animals)}
      switcher={<KindSwitch kind={kind} options={SWITCH} onKind={onKind} />}
      onSubmit={() => void submit()}
      submitLabel={`Save for ${forCount(animals.length)}`}
      busy={busy}
      error={error}
    >
      <TextArea
        label="Note"
        rows={5}
        value={text}
        onChange={(event) => setText(event.target.value)}
        required
      />
    </DetailsForm>
  );
}

function PhotoForm({ propertyId, actorId, kind, onKind, animals, onSaved }: DetailsProps) {
  const [files, setFiles] = useState<readonly File[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // One intake per animal: the shared hook is bound to one owner, and the
  // photo goes on each animal's own record.
  const intakes = useRef(new Map<Ulid, PhotoIntake>());
  const register = useCallback((id: Ulid, intake: PhotoIntake | undefined) => {
    // crud-guard: allow-unconfirmed — forgets an in-memory photo intake, not a record
    if (intake === undefined) intakes.current.delete(id);
    else intakes.current.set(id, intake);
  }, []);

  async function submit() {
    setError(undefined);
    if (files.length === 0) {
      setError("Take or choose a photo first");
      return;
    }

    setBusy(true);
    try {
      for (const animal of animals) {
        const intake = intakes.current.get(animal.id);
        if (intake === undefined) {
          setError("The photo store is not ready yet — try again in a moment");
          return;
        }
        await intake.attach(files);
      }
      onSaved({
        headline: `Saved for ${forCount(animals.length)}`,
        detail: `${files.length === 1 ? "1 photo" : `${files.length} photos`} each — uploads on its own once there is signal.`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailsForm
      title="Photo"
      who={whoLine(animals)}
      switcher={<KindSwitch kind={kind} options={SWITCH} onKind={onKind} />}
      onSubmit={() => void submit()}
      submitLabel={`Save for ${forCount(animals.length)}`}
      busy={busy}
      error={error}
    >
      {animals.map((animal) => (
        <Intake
          key={animal.id}
          propertyId={propertyId}
          actorId={actorId}
          animalId={animal.id}
          register={register}
        />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <PhotoCapture
          camera
          label={files.length === 0 ? "Take a photo" : "Retake"}
          variant={files.length === 0 ? "primary" : "secondary"}
          onPick={(picked) => setFiles(picked)}
        />
        <PhotoCapture label="From the camera roll" onPick={(picked) => setFiles(picked)} />
      </div>
      {files.length === 0 ? null : (
        <ul aria-label="Chosen photos" className="flex flex-col gap-1 text-sm text-muted">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="truncate">
              {file.name}
            </li>
          ))}
        </ul>
      )}
    </DetailsForm>
  );
}

/** Mounts the shared photo intake for one animal and hands it up. */
function Intake({
  propertyId,
  actorId,
  animalId,
  register,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly animalId: Ulid;
  readonly register: (id: Ulid, intake: PhotoIntake | undefined) => void;
}) {
  const intake = useAttachPhotos({ propertyId, actorId, ownerEntity: "Animal", ownerId: animalId });
  useEffect(() => {
    register(animalId, intake);
    return () => register(animalId, undefined);
  }, [animalId, intake, register]);
  return null;
}
