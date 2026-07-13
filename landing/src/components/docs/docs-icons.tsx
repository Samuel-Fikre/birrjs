import {
  Blocks,
  BookMarked,
  BookOpen,
  Code,
  Compass,
  CreditCard,
  Database,
  Download,
  Landmark,
  Mail,
  MessageSquare,
  Monitor,
  Package,
  Repeat,
  Rocket,
  Shield,
  Terminal,
  Ticket,
  Timer,
  Users,
  Webhook,
} from "lucide-react";
import type { ReactElement } from "react";

const categoryIcons = {
  "get started": <Compass className="docs-category-icon size-3.5! shrink-0" />,
  concepts: <BookMarked className="docs-category-icon size-3.5! shrink-0" />,
  providers: <CreditCard className="docs-category-icon size-3.5! shrink-0" />,
  plugins: <Blocks className="docs-category-icon size-3.5! shrink-0" />,
  guides: <BookOpen className="docs-category-icon size-3.5! shrink-0" />,
} as const;

const pageIcons = {
  index: <BookOpen className="docs-category-icon size-3! shrink-0" />,
  "get started": <BookOpen className="docs-category-icon size-3! shrink-0" />,
  installation: <Download className="docs-category-icon size-3! shrink-0" />,
  quickstart: <Rocket className="docs-category-icon size-3! shrink-0" />,
  plans: <Package className="docs-category-icon size-3! shrink-0" />,
  customers: <Users className="docs-category-icon size-3! shrink-0" />,
  subscriptions: <Repeat className="docs-category-icon size-3! shrink-0" />,
  cron: <Timer className="docs-category-icon size-3! shrink-0" />,
  entitlements: <Shield className="docs-category-icon size-3! shrink-0" />,
  webhooks: <Webhook className="docs-category-icon size-3! shrink-0" />,
  database: <Database className="docs-category-icon size-3! shrink-0" />,
  providers: <CreditCard className="docs-category-icon size-3! shrink-0" />,
  plugins: <Blocks className="docs-category-icon size-3! shrink-0" />,
  afromessage: <MessageSquare className="docs-category-icon size-3! shrink-0" />,
  "your first plugin": <Code className="docs-category-icon size-3! shrink-0" />,
  fayda: <Landmark className="docs-category-icon size-3! shrink-0" />,
  coupon: <Ticket className="docs-category-icon size-3! shrink-0" />,
  resend: <Mail className="docs-category-icon size-3! shrink-0" />,
  client: <Monitor className="docs-category-icon size-3! shrink-0" />,
  cli: <Terminal className="docs-category-icon size-3! shrink-0" />,
} as const;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .replaceAll(".", "")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getDocsCategoryIcon(name: string): ReactElement | undefined {
  return categoryIcons[normalizeName(name) as keyof typeof categoryIcons];
}

export function getDocsPageIcon(name: string): ReactElement | undefined {
  return pageIcons[normalizeName(name) as keyof typeof pageIcons];
}
