import pages from "./en.json" with { type: "json" };

/** Existing slugs retain their public URLs; both languages use the same slugs. */
export function getDocumentationRoutes() {
  return ["fr", "en"].flatMap((locale) =>
    pages.map(
      (page) =>
        `/docs/${locale === "en" ? "en/" : ""}${page.slug ? `${page.slug}/` : ""}`,
    ),
  );
}
