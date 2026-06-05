import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { notFound, redirect } from "next/navigation";

import { CopyMarkdownButton } from "@/components/docs/copy-markdown-button";
import { EnvBlock } from "@/components/docs/env-block";
import { source } from "@/lib/source";

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;

  if (!params.slug || params.slug.length === 0) {
    redirect("/docs/get-started");
  }

  const page = source.getPage(params.slug);

  if (!page) {
    notFound();
  }

  const MDXContent = page.data.body;

  const baseDir = join(process.cwd(), "content/docs");
  const slugPath = join(baseDir, ...params.slug);
  const rawPath = existsSync(slugPath + ".mdx") ? slugPath + ".mdx" : join(slugPath, "index.mdx");
  const rawContent = readFileSync(rawPath, "utf-8");

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      {page.data.description ? <DocsDescription>{page.data.description}</DocsDescription> : null}
      <div className="-mt-6 border-b pb-5 mb-4">
        <CopyMarkdownButton rawContent={rawContent} />
      </div>
      <DocsBody>
        <MDXContent
          components={{
            ...defaultMdxComponents,
            Callout,
            Card,
            Cards,
            EnvBlock,
            Step,
            Steps,
            Tab,
            Tabs,
          }}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;

  if (!params.slug || params.slug.length === 0) {
    return {
      title: "Documentation",
    };
  }

  const page = source.getPage(params.slug);

  if (!page) {
    notFound();
  }

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
