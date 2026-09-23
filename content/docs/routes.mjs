import pages from "./en.json" with { type: "json" };

/** Public slugs intentionally retain the original French URLs in both languages. */
export function getDocumentationRoutes() {
  return ["fr", "en"].flatMap((locale) =>
    pages.map(
      (page) =>
        `/docs/${locale === "en" ? "en/" : ""}${page.slug ? `${page.slug}/` : ""}`,
    ),
  );
}
