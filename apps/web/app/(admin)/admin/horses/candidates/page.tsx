import { PagePlaceholder } from "../../../../_components/page-placeholder";

export const metadata = { title: "Horses Under Consideration" };

export default function AdminHorsesCandidatesPage() {
  return (
    <PagePlaceholder
      title={"Horses Under Consideration"}
      route={"/admin/horses/candidates"}
      phase={"Phase 2"}
    />
  );
}
