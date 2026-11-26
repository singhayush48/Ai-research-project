import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelRight } from 'lucide-react';
import { api } from '../services/api.js';
import { buildDiscoverQuery, STAGES } from '../constants/research.js';
import WelcomeScreen from '../components/WelcomeScreen.jsx';
import ConversationFeed from '../components/ConversationFeed.jsx';
import ResearchContextPanel from '../components/ResearchContextPanel.jsx';
import Composer from '../components/Composer.jsx';
import PaperPreviewModal from '../components/PaperPreviewModal.jsx';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { normalizePaper } from '../utils/paper.js';

function getSelectedFlag(paper) {
  return paper.selected_for_analysis !== undefined ? paper.selected_for_analysis : Boolean(paper.selectedForAnalysis);
}

const STAGE_ORDER = STAGES.map((s) => s.key);

export default function ChatWorkspace({ projectId, initialSuggestion, onProjectMutated, onOpenContextChange, contextMobileOpen, navigate }) {
  const [project, setProject] = useState(null);
  const [papers, setPapers] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [lastFailedAction, setLastFailedAction] = useState(null);
  const [pendingLabel, setPendingLabel] = useState('');
  const [busyPaperId, setBusyPaperId] = useState(null);
  const [selectionOverrides, setSelectionOverrides] = useState(new Map());
  const [removedPaperIds, setRemovedPaperIds] = useState(new Set());
  const [previewPaper, setPreviewPaper] = useState(null);
  const [suggestion, setSuggestion] = useState(initialSuggestion || null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  useEffect(() => {
    setSuggestion(initialSuggestion || null);
  }, [initialSuggestion, projectId]);

  const loadAll = useCallback(async (id) => {
    setLoading(true);
    setLoadError('');
    try {
      const [projectData, timelineData] = await Promise.all([api.getProject(id), api.getProjectTimeline(id)]);
      setProject(projectData.project);
      setPapers(projectData.papers || []);
      setEvents(timelineData.events || []);
      setSelectionOverrides(new Map());
      setRemovedPaperIds(new Set());
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (projectId) loadAll(projectId);
    else {
      setProject(null);
      setPapers([]);
      setEvents([]);
    }
  }, [projectId, loadAll]);

  // The server now advances the research stage itself as part of each
  // action and returns it, so no extra PUT /projects/:id round trip (with a
  // full copy of the project) is needed. Only ever moves forward.
  function applyStage(newStage) {
    if (!newStage) return;
    let advanced = false;
    setProject((prev) => {
      if (!prev) return prev;
      const current = STAGE_ORDER.indexOf(prev.stage || 'define');
      const next = STAGE_ORDER.indexOf(newStage);
      if (next > current) {
        advanced = true;
        return { ...prev, stage: newStage };
      }
      return prev;
    });
    // Sidebar ordering depends on updated_at, which the server just bumped.
    onProjectMutated && onProjectMutated();
    return advanced;
  }

  async function handleStartResearch(topic) {
    setStarting(true);
    setStartError('');
    try {
      const data = await api.kickoffResearch(topic);
      onProjectMutated && onProjectMutated();
      navigate('chat', { id: data.project.id, initialSuggestion: data.suggestion });
    } catch (err) {
      setStartError(err.message);
    } finally {
      setStarting(false);
    }
  }

  async function handleUseSuggestedQuestion(question) {
    if (!project) return;
    setSuggestion(null);
    try {
      const { project: updated } = await api.updateProject(project.id, {
        title: project.title,
        researchQuestion: question,
        description: project.description,
        notes: project.notes,
        researchObjective: project.research_objective,
        researchType: project.research_type,
        stage: 'discover',
      });
      setProject(updated);
      onProjectMutated && onProjectMutated();
    } catch (err) {
      setActionError(err.message);
    }
    runSearch(question);
  }

  // Merges freshly-seen papers (from any 'search'-shaped event: a real
  // OpenAlex search, "show me my selected sources", "top 5 most relevant",
  // "find similar to paper 4"...) into the project's paper list, the same
  // way runSearch always has. Existing papers are left untouched so a
  // repeat mention never clobbers current selection state.
  function mergeDiscoveredPapers(results) {
    setPapers((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      for (const r of results) {
        if (!byId.has(r.id)) {
          byId.set(r.id, {
            id: r.id,
            title: r.title,
            authors: JSON.stringify(r.authors || []),
            abstract: r.abstract,
            publication_year: r.publicationYear,
            source_name: r.sourceName,
            doi: r.doi,
            paper_url: r.paperUrl,
            cited_by_count: r.citedByCount,
            selected_for_analysis: Boolean(r.selectedForAnalysis),
          });
        }
      }
      return Array.from(byId.values());
    });
  }

  // Rough client-side guess at what the natural-language message is about
  // to trigger, purely so the "thinking" state shows a specific, honest
  // status ("Searching academic literature...") instead of a generic
  // spinner while the server (which makes the real decision) is working.
  function guessPendingLabel(text) {
    const lower = text.toLowerCase();
    if (/\b(find|search|look for|look up)\b.*\b(paper|papers|studies|study|literature|articles)\b/.test(lower) ||
        /\b(papers?|studies|literature|articles)\b.*\b(about|on|regarding|related to)\b/.test(lower)) {
      return 'Searching academic literature...';
    }
    if (/\banalyz/.test(lower)) return 'Analyzing your selected sources...';
    if (/\bresearch gaps?\b|understudied|underexplored/.test(lower)) return 'Looking for research gaps...';
    if (/\bresearch plan\b|methodology/.test(lower)) return 'Building a research plan...';
    if (/\b(write|draft|generate|create)\b.*\b(literature review|proposal|introduction|methodology|report)\b/.test(lower)) {
      return 'Drafting...';
    }
    if (/\bcompare\b/.test(lower)) return 'Comparing sources...';
    return 'Thinking...';
  }

  async function handleSendMessage(text) {
    if (!project) return;
    setActionError('');
    setLastFailedAction(null);
    const localId = `local-msg-${Date.now()}`;
    setEvents((prev) => [...prev, { type: 'user_message', id: localId, createdAt: new Date().toISOString(), content: text }]);
    await sendMessageToRouter(text);
  }

  // Split out from handleSendMessage so a failed request can be retried
  // without re-adding a duplicate user-message bubble to the feed.
  async function sendMessageToRouter(text, isRetry = false) {
    setPendingLabel(guessPendingLabel(text));
    try {
      const data = await api.routeChatMessage(project.id, text, isRetry);

      setEvents((prev) => [
        ...prev,
        {
          type: 'assistant_message',
          id: `message-${data.assistantMessage.id}`,
          createdAt: data.assistantMessage.createdAt,
          content: data.assistantMessage.content,
        },
      ]);

      if (data.event) {
        setEvents((prev) => [...prev, data.event]);
        if (data.event.type === 'search') {
          mergeDiscoveredPapers(data.event.papers || []);
        }
      }

      if (Array.isArray(data.selectionUpdates)) {
        setSelectionOverrides((prev) => {
          const next = new Map(prev);
          for (const u of data.selectionUpdates) next.set(u.paperId, u.selected);
          return next;
        });
        setPapers((prev) =>
          prev.map((p) => {
            const update = data.selectionUpdates.find((u) => u.paperId === p.id);
            return update ? { ...p, selected_for_analysis: update.selected } : p;
          })
        );
      }

      applyStage(data.stage);
    } catch (err) {
      setActionError(err.message);
      setLastFailedAction(() => () => sendMessageToRouter(text, true));
    } finally {
      setPendingLabel('');
    }
  }

  async function runSearch(queryTextRaw) {
    if (!project) return;
    setActionError('');
    setLastFailedAction(null);
    const q = (queryTextRaw || '').trim() || buildDiscoverQuery(project);
    if (!q) {
      setActionError('Type a topic or question to search for.');
      return;
    }
    setPendingLabel(`Searching the literature for "${q}"...`);
    try {
      const data = await api.searchPapers(q, 1, project.id);
      const results = data.results || [];
      setEvents((prev) => [
        ...prev,
        { type: 'search', id: `local-search-${Date.now()}`, createdAt: new Date().toISOString(), query: q, papers: results },
      ]);
      mergeDiscoveredPapers(results);
      applyStage(data.stage || 'discover');
    } catch (err) {
      setActionError(err.message);
      setLastFailedAction(() => () => runSearch(queryTextRaw));
    } finally {
      setPendingLabel('');
    }
  }

  async function setPaperSelection(paperId, selected) {
    if (!project) return;
    setActionError('');
    setLastFailedAction(null);
    setBusyPaperId(paperId);
    try {
      await api.addPaperToProject(project.id, { paperId, selected });
      setSelectionOverrides((prev) => new Map(prev).set(paperId, selected));
      setPapers((prev) => prev.map((p) => (p.id === paperId ? { ...p, selected_for_analysis: selected } : p)));
    } catch (err) {
      setActionError(err.message);
      setLastFailedAction(() => () => setPaperSelection(paperId, selected));
    } finally {
      setBusyPaperId(null);
    }
  }

  async function removePaper(paperId) {
    if (!project) return;
    setActionError('');
    setLastFailedAction(null);
    try {
      await api.removePaperFromProject(project.id, paperId);
      setPapers((prev) => prev.filter((p) => p.id !== paperId));
      setRemovedPaperIds((prev) => new Set(prev).add(paperId));
      setSelectionOverrides((prev) => {
        const next = new Map(prev);
        next.delete(paperId);
        return next;
      });
    } catch (err) {
      setActionError(err.message);
      setLastFailedAction(() => () => removePaper(paperId));
    }
  }

  function selectedPaperIds() {
    return papers
      .filter((p) => (selectionOverrides.has(p.id) ? selectionOverrides.get(p.id) : getSelectedFlag(p)))
      .map((p) => p.id);
  }

  async function runAnalyze() {
    if (!project) return;
    setActionError('');
    setLastFailedAction(null);
    setPendingLabel('Analyzing your selected sources...');
    try {
      const data = await api.analyzeProjectSources(project.id);
      setEvents((prev) => [
        ...prev,
        { type: 'intelligence', id: `intel-${data.intelligenceId}`, createdAt: data.createdAt, content: data.intelligence, sources: data.sources },
      ]);
      applyStage(data.stage || 'analyze');
    } catch (err) {
      setActionError(err.message);
      setLastFailedAction(() => runAnalyze);
    } finally {
      setPendingLabel('');
    }
  }

  async function runGaps() {
    if (!project) return;
    setActionError('');
    setLastFailedAction(null);
    setPendingLabel('Looking for research gaps across your sources...');
    try {
      const data = await api.identifyResearchGaps(project.id);
      setEvents((prev) => [...prev, { type: 'gaps', id: `gaps-${data.gapsId}`, createdAt: data.createdAt, content: data.gaps, sources: data.sources }]);
      applyStage(data.stage || 'gaps');
    } catch (err) {
      setActionError(err.message);
      setLastFailedAction(() => runGaps);
    } finally {
      setPendingLabel('');
    }
  }

  async function runPlan() {
    if (!project) return;
    setActionError('');
    setLastFailedAction(null);
    setPendingLabel('Building a research plan from your identified gaps...');
    try {
      const data = await api.buildResearchPlan(project.id);
      setEvents((prev) => [...prev, { type: 'plan', id: `plan-${data.planId}`, createdAt: data.createdAt, content: data.plan, sources: data.sources }]);
      applyStage(data.stage || 'plan');
    } catch (err) {
      setActionError(err.message);
      setLastFailedAction(() => runPlan);
    } finally {
      setPendingLabel('');
    }
  }

  async function runDraft(regenerate = false) {
    if (!project) return;
    const ids = selectedPaperIds();
    if (ids.length === 0) {
      setActionError('Select at least one source before generating a draft.');
      return;
    }
    setActionError('');
    setLastFailedAction(null);
    setPendingLabel('Writing a literature review from your selected sources...');
    try {
      const data = await api.generateDraft(project.id, ids, regenerate === true);
      setEvents((prev) => [...prev, { type: 'draft', id: `report-${data.reportId}`, createdAt: data.createdAt, content: data.draft, sources: data.sources }]);
      applyStage(data.stage || 'create');
    } catch (err) {
      setActionError(err.message);
      setLastFailedAction(() => () => runDraft(regenerate));
    } finally {
      setPendingLabel('');
    }
  }

  function handleQuickAction(type, searchText) {
    if (pendingLabel) return;
    if (type === 'search') runSearch(searchText);
    else if (type === 'analyze') runAnalyze();
    else if (type === 'gaps') runGaps();
    else if (type === 'plan') runPlan();
    else if (type === 'draft') runDraft();
  }

  const openPreview = useCallback((paperObjOrRow) => {
    if (!paperObjOrRow) return;
    setPreviewPaper(normalizePaper(paperObjOrRow));
  }, []);

  const visibleEvents = useMemo(
    () =>
      events.map((e) =>
        e.type === 'search' ? { ...e, papers: e.papers.filter((p) => !removedPaperIds.has(p.id)) } : e
      ),
    [events, removedPaperIds]
  );

  const hasSelectedSources = selectedPaperIds().length > 0;
  const hasGaps = events.some((e) => e.type === 'gaps');

  if (!projectId) {
    return <WelcomeScreen onStart={handleStartResearch} starting={starting} error={startError} />;
  }

  if (loading && !project) {
    return <Loading label="Loading research chat..." />;
  }

  if (loadError) {
    return <ErrorBanner message={loadError} />;
  }

  if (!project) return null;

  return (
    <div className="chat-workspace">
      <div className="chat-workspace-main">
        <div className="chat-workspace-header">
          <h2 className="chat-workspace-title">{project.title}</h2>
          <button className="btn btn-ghost btn-small context-toggle-btn" onClick={() => onOpenContextChange(true)}>
            <PanelRight /> Research panel
          </button>
        </div>

        {actionError && (
          <ErrorBanner
            message={actionError}
            onDismiss={() => {
              setActionError('');
              setLastFailedAction(null);
            }}
            onRetry={
              lastFailedAction
                ? () => {
                    setActionError('');
                    const action = lastFailedAction;
                    setLastFailedAction(null);
                    action();
                  }
                : undefined
            }
          />
        )}

        <ConversationFeed
          events={visibleEvents}
          selectionOverrides={selectionOverrides}
          busyPaperId={busyPaperId}
          onPreviewPaper={openPreview}
          onSelectPaper={(id) => setPaperSelection(id, true)}
          onDeselectPaper={(id) => setPaperSelection(id, false)}
          pendingLabel={pendingLabel}
          suggestion={suggestion}
          onUseSuggestedQuestion={handleUseSuggestedQuestion}
          regeneratingDraft={Boolean(pendingLabel)}
          onRegenerateDraft={() => runDraft(true)}
        />

        <Composer
          onSendMessage={handleSendMessage}
          onQuickAction={handleQuickAction}
          busy={Boolean(pendingLabel)}
          hasSelectedSources={hasSelectedSources}
          hasGaps={hasGaps}
        />
      </div>

      <ResearchContextPanel
        project={project}
        papers={papers}
        selectionOverrides={selectionOverrides}
        hasIntelligence={events.some((e) => e.type === 'intelligence')}
        hasGaps={hasGaps}
        hasPlan={events.some((e) => e.type === 'plan')}
        hasDraft={events.some((e) => e.type === 'draft')}
        onPreviewPaper={openPreview}
        onDeselectPaper={(id) => setPaperSelection(id, false)}
        onRemovePaper={removePaper}
        onQuickAction={handleQuickAction}
        actionsBusy={Boolean(pendingLabel)}
        mobileOpen={contextMobileOpen}
        onCloseMobile={() => onOpenContextChange(false)}
      />

      {previewPaper && (
        <PaperPreviewModal
          paper={previewPaper}
          isSelected={
            selectionOverrides.has(previewPaper.localId)
              ? selectionOverrides.get(previewPaper.localId)
              : (() => {
                  const live = papers.find((p) => p.id === previewPaper.localId);
                  return live ? getSelectedFlag(live) : Boolean(previewPaper.selectedForAnalysis);
                })()
          }
          busy={busyPaperId === previewPaper.localId}
          onClose={() => setPreviewPaper(null)}
          onSelect={previewPaper.localId ? () => setPaperSelection(previewPaper.localId, true) : undefined}
          onDeselect={previewPaper.localId ? () => setPaperSelection(previewPaper.localId, false) : undefined}
        />
      )}
    </div>
  );
}
