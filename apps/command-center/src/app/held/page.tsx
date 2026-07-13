import { redirect } from 'next/navigation';

/** Legacy surface absorbed by the v2 IA — see UTV2-1522 diff summary. */
export default function LegacyRedirect() {
  redirect('/operations/approvals');
}
