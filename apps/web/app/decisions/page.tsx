import { Suspense } from "react";
import { DecisionsRoom } from "@/components/decisions/decisions-room";

/** Decisions (the room reads ?system= from the URL, hence Suspense). */
export default function DecisionsPage() {
  return (
    <Suspense>
      <DecisionsRoom />
    </Suspense>
  );
}
