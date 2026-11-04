import { useEffect, useRef } from "react";
import { listingElement, type ListingPreview as Preview } from "../lib/listing-dom";
export default function ListingPreview({ preview }: { preview: Preview }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current?.replaceChildren(listingElement(preview));
  }, [preview]);
  return <div ref={host} />;
}
