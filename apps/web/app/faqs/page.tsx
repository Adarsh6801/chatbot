import PublicSitePageView from "@/components/PublicSitePageView";

export const metadata = {
  title: "FAQs | AgentForge",
  description: "Frequently asked questions about building AI support agents, uploading knowledge sources, workflows, and APIs.",
};

export default function FaqsPage() {
  return <PublicSitePageView slug="faqs" />;
}
