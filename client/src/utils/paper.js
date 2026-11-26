// Normalizes a paper into one consistent (camelCase) shape regardless of
// where it came from:
//  - an OpenAlex search result (already camelCase, authors already an array)
//  - a "source" object returned by the research-intelligence endpoint
//    (also already camelCase, authors already an array)
//  - a raw local DB row (snake_case, authors stored as a JSON string)
// PaperCard / PaperPreviewModal only ever deal with this normalized shape.
export function normalizePaper(paper) {
  if (!paper) return null;

  // Already-normalized shapes: authors is an array (or simply absent).
  if (Array.isArray(paper.authors) || paper.authors === undefined) {
    return {
      localId: paper.id ?? paper.localId ?? null,
      openalexId: paper.openalexId,
      title: paper.title,
      authors: paper.authors || [],
      abstract: paper.abstract,
      publicationYear: paper.publicationYear,
      sourceName: paper.sourceName,
      doi: paper.doi,
      paperUrl: paper.paperUrl,
      citedByCount: paper.citedByCount,
      relevanceScore: paper.relevanceScore ?? null,
      selectedForAnalysis: paper.selectedForAnalysis ?? paper.selected_for_analysis,
      analyzed: paper.analyzed,
    };
  }

  // Raw local DB row (snake_case, authors as a JSON string).
  let authors = paper.authors;
  if (typeof authors === 'string') {
    try {
      authors = JSON.parse(authors);
    } catch {
      authors = [];
    }
  }

  return {
    localId: paper.id,
    openalexId: paper.openalex_id,
    title: paper.title,
    authors: authors || [],
    abstract: paper.abstract,
    publicationYear: paper.publication_year,
    sourceName: paper.source_name,
    doi: paper.doi,
    paperUrl: paper.paper_url,
    citedByCount: paper.cited_by_count,
    relevanceScore: null,
    selectedForAnalysis: paper.selected_for_analysis,
    analyzed: paper.analyzed,
  };
}
