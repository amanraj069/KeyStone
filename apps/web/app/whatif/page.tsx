import { Suspense } from "react";
import { WhatIfRoom } from "@/components/whatif/whatif-room";

/** What-if: simulate a departure (the room reads ?person= from the URL, hence Suspense). */
export default function WhatIfPage() {
  return (
    <Suspense>
      <WhatIfRoom />
    </Suspense>
  );
}
