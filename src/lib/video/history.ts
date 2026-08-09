/**
 * Historique Undo / Redo de l'éditeur vidéo — étape 8.
 *
 * Chaque action de montage ou de réglage est enregistrée comme un snapshot
 * immuable `{ project, edit }`. Le modèle de `project.ts` et `edit.ts`
 * étant déjà purement fonctionnel, l'annulation consiste simplement à
 * restaurer un état précédent.
 *
 * Les changements continus sur les réglages (sliders) sont regroupés :
 * une rafale de modifications en moins de 250 ms ne produit qu'une seule
 * entrée dans l'historique. Les actions discrètes (coupe, ajout de calque,
 * etc.) sont poussées immédiatement.
 */
import { useCallback, useReducer, useRef } from "react";
import type { VideoEdit } from "@/lib/video/edit";
import type { VideoProject } from "@/lib/video/project";

type HistoryEntry = { project: VideoProject; edit: VideoEdit };

type State = {
  project: VideoProject;
  edit: VideoEdit;
  past: HistoryEntry[];
  future: HistoryEntry[];
};

type Action =
  | { type: "SET_PROJECT"; fn: (p: VideoProject) => VideoProject; push: boolean }
  | { type: "SET_EDIT"; fn: (e: VideoEdit) => VideoEdit }
  | { type: "PUSH"; entry: HistoryEntry }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "RESET"; entry: HistoryEntry };

const DEBOUNCE_MS = 250;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_PROJECT": {
      const nextProject = action.fn(state.project);
      if (nextProject === state.project) return state;
      if (!action.push) {
        return { ...state, project: nextProject, future: [] };
      }
      return {
        project: nextProject,
        edit: state.edit,
        past: [...state.past, { project: state.project, edit: state.edit }],
        future: [],
      };
    }
    case "SET_EDIT": {
      const nextEdit = action.fn(state.edit);
      if (nextEdit === state.edit) return state;
      return { ...state, edit: nextEdit, future: [] };
    }
    case "PUSH":
      return {
        ...state,
        past: [...state.past, action.entry],
        future: [],
      };
    case "UNDO": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        project: previous.project,
        edit: previous.edit,
        past: state.past.slice(0, -1),
        future: [{ project: state.project, edit: state.edit }, ...state.future],
      };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        project: next.project,
        edit: next.edit,
        past: [...state.past, { project: state.project, edit: state.edit }],
        future: state.future.slice(1),
      };
    }
    case "RESET":
      return {
        project: action.entry.project,
        edit: action.entry.edit,
        past: [],
        future: [],
      };
  }
}

export type HistoryOptions = { history?: boolean };

export function useVideoHistory(initial: HistoryEntry) {
  const [state, dispatch] = useReducer(reducer, {
    project: initial.project,
    edit: initial.edit,
    past: [],
    future: [],
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const debounceRef = useRef<number | null>(null);
  const pendingRef = useRef<HistoryEntry | null>(null);

  const flushEditDebounced = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (pendingRef.current) {
      dispatch({ type: "PUSH", entry: pendingRef.current });
      pendingRef.current = null;
    }
  }, []);

  const setProject = useCallback(
    (fn: (p: VideoProject) => VideoProject, opts: HistoryOptions = {}) => {
      // Un changement de montage est une action discrète : on vide
      // immédiatement toute rafale de réglages en cours pour ne pas
      // mélanger les deux dans un même pas d'historique.
      flushEditDebounced();
      dispatch({ type: "SET_PROJECT", fn, push: opts.history !== false });
    },
    [flushEditDebounced],
  );

  const setEdit = useCallback((fn: (e: VideoEdit) => VideoEdit, opts: HistoryOptions = {}) => {
    dispatch({ type: "SET_EDIT", fn });
    if (opts.history === false) return;

    if (debounceRef.current === null) {
      pendingRef.current = { project: stateRef.current.project, edit: stateRef.current.edit };
    } else {
      window.clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      if (pendingRef.current) {
        dispatch({ type: "PUSH", entry: pendingRef.current });
        pendingRef.current = null;
      }
    }, DEBOUNCE_MS);
  }, []);

  const undo = useCallback(() => {
    flushEditDebounced();
    dispatch({ type: "UNDO" });
  }, [flushEditDebounced]);

  const redo = useCallback(() => {
    flushEditDebounced();
    dispatch({ type: "REDO" });
  }, [flushEditDebounced]);

  const reset = useCallback(
    (entry: HistoryEntry) => {
      flushEditDebounced();
      dispatch({ type: "RESET", entry });
    },
    [flushEditDebounced],
  );

  return {
    project: state.project,
    edit: state.edit,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    setProject,
    setEdit,
    undo,
    redo,
    reset,
  };
}
