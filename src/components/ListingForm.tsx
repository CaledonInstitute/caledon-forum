import { useEffect, useState } from "react";
import FileUpload from "./FileUpload";
import type { Listing } from "../lib/marketplace";
import type { Attachment } from "../lib/upload-policy";
export default function ListingForm({ listing }: { listing?: Listing }) {
  const [kind, setKind] = useState(listing?.kind || "goods");
  const [photos, setPhotos] = useState<Attachment[]>(listing?.photos || []);
  const [uploading, setUploading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  async function save(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading || busy) return;
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const r = await fetch("/api/marketplace/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: listing?.id,
          kind,
          title: data.get("title"),
          description: data.get("description"),
          price: Number(data.get("price")),
          negotiable: data.get("negotiable") === "on",
          location: data.get("location"),
          condition: kind === "goods" ? data.get("condition") : null,
          photoIds: photos.map((p) => p.id),
        }),
      });
      const result = (await r.json()) as any;
      if (!r.ok) throw new Error(result.error || "Could not save your listing.");
      location.assign(result.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="listing-form" method="post" onSubmit={save}>
      <fieldset disabled={!ready || busy}>
        <legend className="sr-only">Listing details</legend>
        <section className="listing-form-section" aria-labelledby="listing-information">
          <h2 id="listing-information">Listing information</h2>
          <label htmlFor="listing-type">
            Type
            <select id="listing-type" aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as "goods" | "service")}>
              <option value="goods">Goods</option>
              <option value="service">Service</option>
            </select>
          </label>
          <label>
            Title
            <input name="title" required minLength={3} maxLength={120} defaultValue={listing?.title} placeholder="What are you offering?" />
          </label>
          <label>
            Description
            <textarea
              name="description"
              required
              minLength={10}
              maxLength={10000}
              rows={5}
              defaultValue={listing?.description}
              placeholder="Describe what is included and how you will arrange the exchange."
            />
          </label>
        </section>
        <section className="listing-form-section" aria-labelledby="listing-pricing">
          <h2 id="listing-pricing">Price and condition</h2>
          <div className="listing-form-row">
            <label>
              Price (IDR)
              <input
                aria-label="Price (IDR)"
                aria-describedby="listing-price-help"
                name="price"
                type="number"
                required
                min={0}
                max={999999999999}
                step={1}
                defaultValue={listing?.price || 0}
              />
              <small id="listing-price-help">Enter 0 for a free listing.</small>
            </label>
            {kind === "goods" && (
              <label htmlFor="listing-condition">
                Condition
                <select id="listing-condition" aria-label="Condition" name="condition" defaultValue={listing?.condition || "used"}>
                  <option value="used">Used</option>
                  <option value="new">New</option>
                </select>
              </label>
            )}
          </div>
          <label className="listing-check">
            <input name="negotiable" type="checkbox" defaultChecked={!!listing?.negotiable} />
            Price is negotiable
          </label>
        </section>
        <section className="listing-form-section" aria-labelledby="listing-location-photos">
          <h2 id="listing-location-photos">Location and photos</h2>
          <label>
            Location (optional)
            <input name="location" maxLength={100} defaultValue={listing?.location} />
          </label>
          <div className="listing-upload" role="group" aria-labelledby="listing-photos-label">
            <p id="listing-photos-label" className="listing-field-label">
              Photos
            </p>
            <FileUpload purpose="post" value={photos} onChange={(files) => setPhotos(files)} onBusy={setUploading} disabled={busy} imagesOnly />
          </div>
        </section>
        <div className="listing-form-footer">
          {!listing && <p className="muted small">Publishing also shares this listing on your timeline.</p>}
          <p className="muted small">Buyers contact you through DM. Agree on payment and delivery directly.</p>
          <p className="error" role="alert">
            {error}
          </p>
          <div className="listing-form-actions">
            <button className="button" disabled={!ready || busy || uploading} type="submit">
              {busy ? "Saving…" : listing ? "Save listing" : "Publish listing"}
            </button>
            <a className="button secondary" href={listing ? `/marketplace/${listing.id}` : "/marketplace"}>
              Cancel
            </a>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
