import { redirect } from "next/navigation";

// Render at request time so the route issues a real HTTP redirect instead of a
// prerendered/cached HTML shell.
export const dynamic = "force-dynamic";

// The standalone "Choose how you want to work" screen has been merged into the
// Studio home (/studio), which now hosts the Playground card, Workflows, and
// Playground History on one page. Keep this route as a redirect so existing
// links (chat/create "back" buttons, the Credits CTA) keep working.
export default function StudioStartRedirect() {
  redirect("/studio");
}
