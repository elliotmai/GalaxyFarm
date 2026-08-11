import { PagePlaceholder } from "../../../_components/page-placeholder";

export const metadata = { title: "Horses" };

export default function AdminHorsesPage() {
  return <PagePlaceholder title={"Horses"} route={"/admin/horses"} phase={"a later phase"} />;
}
