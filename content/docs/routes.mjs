import pages from "./en.json" with { type: "json" };

/** Generate both language routes from the current article slugs. */
export function getDocumentationRoutes() {
  return ["fr", "en"].flatMap((locale) =>
    pages.map(
      (page) =>
        `/docs/${locale === "en" ? "en/" : ""}${page.slug ? `${page.slug}/` : ""}`,
    ),
  );
}
