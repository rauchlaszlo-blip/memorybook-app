import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import * as fabric from 'fabric';
import type { AppLanguage } from './i18n';
import { getInviteEditorMessages } from './inviteEditorI18n';
import { optimizeGuestImage } from './optimizeGuestImage';

export interface PageData {
  id: string;
  pageNumber: number;
  canvasData?: Record<string, any>;
  previewImageUrl?: string;
  version: number;
}

export interface MemoryBookEditorRef {
  flush: () => Promise<void>;
  resolveConflictKeepLocal: (latestRemoteVersion: number) => void;
}

interface MemoryBookEditorProps {
  page: PageData;
  onSavePage: (
    pageId: string,
    canvasJson: Record<string, any>,
    previewDataUrl: string,
    expectedVersion: number
  ) => Promise<{ newVersion: number }>;
  onConflict?: (pageId: string) => void;
  language?: AppLanguage;
  newTextWidth?: number;
  newTextFontSize?: number;
  newTextTop?: number;
  newTextAlign?: 'left' | 'center' | 'right';
  enableBackgroundControls?: boolean;
  compactLayout?: boolean;
  optimizeUploadedImages?: boolean;
}

type PendingSave = {
  revision: number;
  json: Record<string, any>;
  previewUrl: string;
};

type PageSaveState = {
  mutationRevision: number;
  savedRevision: number;
  version: number;
  conflict: boolean;
  pending?: PendingSave;
  activeSavePromise?: Promise<void>;
};

type WorkerResult = 'drained' | 'network-error' | 'conflict';

const CANVAS_WIDTH = 750;
const CANVAS_HEIGHT = 1064;
const AUTOSAVE_DEBOUNCE_MS = 2000;
const MAX_IMAGE_INITIAL_DIM = 400;
const DEFAULT_TEXT_FONT_SIZE = 33;
const DEFAULT_TEXT_WIDTH = 560;
const TEXT_KEYBOARD_GAP = 24;
const MOBILE_CONTROL_SIZE = 32;
const INITIAL_TEXTBOX_SIZE_SCALE = 1.5;

const COVER_BACKGROUND_COLLECTION = [
  { id: 'tropical-light', src: '/cover-backgrounds/tropical-light.webp', hu: 'Trópusi világos', en: 'Light tropical', de: 'Tropisch hell' },
  { id: 'tropical-night', src: '/cover-backgrounds/tropical-night.webp', hu: 'Trópusi éjszaka', en: 'Tropical night', de: 'Tropische Nacht' },
  { id: 'romantic-hearts', src: '/cover-backgrounds/romantic-hearts.webp', hu: 'Romantikus', en: 'Romantic', de: 'Romantisch' },
  { id: 'botanical-sage', src: '/cover-backgrounds/botanical-sage.webp', hu: 'Botanikus', en: 'Botanical', de: 'Botanisch' },
  { id: 'celebration', src: '/cover-backgrounds/celebration.webp', hu: 'Ünnepi', en: 'Celebration', de: 'Festlich' },
] as const;

const configureObjectControls = (object: fabric.FabricObject) => {
  object.set({
    borderColor: '#2563eb',
    cornerColor: '#ffffff',
    cornerStrokeColor: '#2563eb',
    cornerStyle: 'circle',
    cornerSize: MOBILE_CONTROL_SIZE,
    touchCornerSize: 80,
    transparentCorners: false,
    padding: 8,
    centeredRotation: true,
    lockRotation: false,
  });
  const isTextbox = object instanceof fabric.Textbox;
  object.setControlsVisibility({
    tl: true,
    tr: true,
    bl: true,
    br: true,
    ml: isTextbox,
    mr: isTextbox,
    mt: isTextbox,
    mb: isTextbox,
    mtr: true,
  });
  if (object.controls.mtr) {
    object.controls.mtr.offsetY = -56;
    object.controls.mtr.withConnection = true;
  }
  object.setCoords();
};

const getTextboxMaxWidth = (object: fabric.FabricObject) => {
  const left = Math.max(0, object.left || 0);
  const scaleX = Math.max(Math.abs(object.scaleX || 1), 0.01);

  if (object.originX === 'center') {
    const halfAvailableWidth = Math.max(0, Math.min(left, CANVAS_WIDTH - left) - 16);
    return Math.max(80, (halfAvailableWidth * 2) / scaleX);
  }

  return Math.max(80, (CANVAS_WIDTH - left - 16) / scaleX);
};

const constrainTextboxToCanvas = (object: fabric.FabricObject) => {
  if (!(object instanceof fabric.Textbox)) return;

  const maxWidth = getTextboxMaxWidth(object);
  object.set({
    splitByGrapheme: true,
    width: Math.min(object.width || DEFAULT_TEXT_WIDTH, maxWidth),
  });
  object.initDimensions();
  object.setCoords();
};

const editorStyles: Record<string, React.CSSProperties> = {
  toolSummary: { listStyle: 'none', minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: '9px 12px', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 7, background: '#ffffff', cursor: 'pointer', fontSize: 14, fontWeight: 700 },
  toolMenu: { position: 'absolute', zIndex: 40, top: 'calc(100% + 6px)', left: 0, minWidth: 190, display: 'grid', gap: 6, padding: 8, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 9, background: '#ffffff', boxShadow: '0 12px 28px rgba(15,23,42,.2)' },
  toolMenuItem: { minHeight: 42, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', boxSizing: 'border-box', border: '1px solid #e2e8f0', borderRadius: 7, background: '#ffffff', cursor: 'pointer', fontSize: 14, fontWeight: 700 },
  collectionMenu: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, padding: 8, border: '1px solid #cbd5e1', borderRadius: 8, background: '#f8fafc' },
  collectionButton: { padding: 5, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', cursor: 'pointer' },
};

export const MemoryBookEditor = forwardRef<
  MemoryBookEditorRef,
  MemoryBookEditorProps
>(({ page, onSavePage, onConflict, language = 'hu', newTextWidth = DEFAULT_TEXT_WIDTH, newTextFontSize = DEFAULT_TEXT_FONT_SIZE, newTextTop = 150, newTextAlign = 'left', enableBackgroundControls = false, compactLayout = false, optimizeUploadedImages = false }, ref) => {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const copy = getInviteEditorMessages(language).editor;

  const [isDrawing, setIsDrawing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [eraserWidth, setEraserWidth] = useState(24);
  const [brushColor, setBrushColor] = useState('#1F2937');
  const [brushWidth, setBrushWidth] = useState(5);
  const [brushTool, setBrushTool] = useState<'pen' | 'pencil' | 'brush'>('pen');
  const [saveStatus, setSaveStatus] = useState<
    'saved' | 'saving' | 'unsaved' | 'conflict'
  >('saved');
  const [hasSelection, setHasSelection] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [canvasScale, setCanvasScale] = useState(1);
  const [imageUploadMessage, setImageUploadMessage] = useState<string | null>(null);

  const pageSaveStatesRef = useRef<Map<string, PageSaveState>>(new Map());
  const currentPageIdRef = useRef(page.id);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadAbortControllerRef = useRef<AbortController | null>(null);

  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const isHistoryApplyingRef = useRef(false);

  const onSavePageRef = useRef(onSavePage);
  useEffect(() => {
    onSavePageRef.current = onSavePage;
  }, [onSavePage]);

  const onConflictRef = useRef(onConflict);
  useEffect(() => {
    onConflictRef.current = onConflict;
  }, [onConflict]);

  const pageDataRef = useRef(page);
  useEffect(() => {
    pageDataRef.current = page;
  }, [page]);

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    const updateScale = () => {
      const availableWidth = viewport.clientWidth || CANVAS_WIDTH;
      const widthScale = availableWidth / CANVAS_WIDTH;
      const availableHeight = Math.max(240, window.innerHeight - viewport.getBoundingClientRect().top - 8);
      const heightScale = compactLayout ? availableHeight / CANVAS_HEIGHT : 1;
      setCanvasScale(Math.min(1, widthScale, heightScale));
    };

    updateScale();
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(updateScale)
        : null;
    observer?.observe(viewport);
    window.addEventListener('resize', updateScale);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [compactLayout]);

  const getPageState = useCallback(
    (pageId: string, initialVersion = 1): PageSaveState => {
      let state = pageSaveStatesRef.current.get(pageId);

      if (!state) {
        state = {
          mutationRevision: 0,
          savedRevision: 0,
          version: initialVersion,
          conflict: false,
        };
        pageSaveStatesRef.current.set(pageId, state);
      }

      return state;
    },
    []
  );

  const updateHistoryButtons = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const pushToHistory = useCallback(() => {
    if (!fabricRef.current || isHistoryApplyingRef.current) return;

    const json = JSON.stringify(fabricRef.current.toJSON());

    if (historyRef.current[historyIndexRef.current] === json) return;

    const nextIndex = historyIndexRef.current + 1;
    historyRef.current = historyRef.current.slice(0, nextIndex);
    historyRef.current.push(json);
    historyIndexRef.current = nextIndex;
    updateHistoryButtons();
  }, [updateHistoryButtons]);

  const runSaveWorker = useCallback(
    async (pageId: string): Promise<WorkerResult> => {
      const state = getPageState(pageId, pageDataRef.current.version);

      while (state.pending && !state.conflict) {
        const snapshotToSave = state.pending;
        state.pending = undefined;

        if (pageId === currentPageIdRef.current) {
          setSaveStatus('saving');
        }

        try {
          const result = await onSavePageRef.current(
            pageId,
            snapshotToSave.json,
            snapshotToSave.previewUrl,
            state.version
          );

          state.version = result.newVersion;
          state.savedRevision = snapshotToSave.revision;

          if (pageId === currentPageIdRef.current) {
            const isFullySynced =
              state.mutationRevision === state.savedRevision && !state.pending;
            setSaveStatus(isFullySynced ? 'saved' : 'unsaved');
          }
        } catch (err: any) {
          state.pending = snapshotToSave;

          if (
            err?.status === 409 ||
            err?.message?.includes('conflict') ||
            err?.message === 'PAGE_CONFLICT'
          ) {
            state.conflict = true;

            if (pageId === currentPageIdRef.current) {
              setSaveStatus('conflict');
            }

            onConflictRef.current?.(pageId);
            return 'conflict';
          }

          console.error(`MentA�si hiba a(z) ${pageId} oldalon:`, err);

          if (pageId === currentPageIdRef.current) {
            setSaveStatus('unsaved');
          }

          return 'network-error';
        }
      }

      return 'drained';
    },
    [getPageState]
  );

  const startWorker = useCallback(
    (pageId: string, state: PageSaveState): Promise<void> => {
      const workerPromise = runSaveWorker(pageId).then(async (result) => {
        state.activeSavePromise = undefined;

        if (result === 'drained' && state.pending && !state.conflict) {
          await startWorker(pageId, state);
          return;
        }

        if (result === 'conflict') {
          throw new Error('PAGE_CONFLICT');
        }

        if (result === 'network-error') {
          throw new Error('PAGE_SAVE_FAILED');
        }
      });

      state.activeSavePromise = workerPromise;
      return workerPromise;
    },
    [runSaveWorker]
  );

  const enqueueSave = useCallback(
    (
      targetPageId: string,
      explicitJson?: Record<string, any>,
      explicitPreviewUrl?: string,
      explicitRevision?: number
    ): Promise<void> => {
      const state = getPageState(targetPageId, pageDataRef.current.version);

      if (state.conflict) {
        return (
          state.activeSavePromise ??
          Promise.reject(new Error('PAGE_CONFLICT'))
        );
      }

      let jsonToSave = explicitJson;
      let previewToSave = explicitPreviewUrl;
      let revisionToSave = explicitRevision ?? state.mutationRevision;

      if (
        !jsonToSave &&
        fabricRef.current &&
        targetPageId === currentPageIdRef.current
      ) {
        jsonToSave = fabricRef.current.toJSON();
        previewToSave = fabricRef.current.toDataURL({
          format: 'jpeg',
          quality: 0.8,
          multiplier: 1,
        });
        revisionToSave = state.mutationRevision;
      }

      if (!jsonToSave || !previewToSave) {
        return state.activeSavePromise ?? Promise.resolve();
      }

      state.pending = {
        revision: revisionToSave,
        json: jsonToSave,
        previewUrl: previewToSave,
      };

      if (targetPageId === currentPageIdRef.current) {
        setSaveStatus('unsaved');
      }

      if (!state.activeSavePromise) {
        return startWorker(targetPageId, state);
      }

      return state.activeSavePromise;
    },
    [getPageState, startWorker]
  );

  const scheduleAutoSave = useCallback(
    (pageId: string) => {
      const state = getPageState(pageId);
      if (state.conflict) return;

      if (pageId === currentPageIdRef.current) {
        setSaveStatus('unsaved');
      }

      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      autoSaveTimerRef.current = setTimeout(() => {
        enqueueSave(pageId).catch(() => {});
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [enqueueSave, getPageState]
  );

  useImperativeHandle(ref, () => ({
    flush: async () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      const activeId = currentPageIdRef.current;
      const state = getPageState(activeId);

      if (state.conflict) {
        throw new Error('PAGE_CONFLICT');
      }

      if (
        state.mutationRevision !== state.savedRevision &&
        fabricRef.current
      ) {
        const json = fabricRef.current.toJSON();
        const preview = fabricRef.current.toDataURL({
          format: 'jpeg',
          quality: 0.8,
          multiplier: 1,
        });

        return enqueueSave(
          activeId,
          json,
          preview,
          state.mutationRevision
        );
      }

      return state.activeSavePromise ?? Promise.resolve();
    },

    resolveConflictKeepLocal: (latestRemoteVersion: number) => {
      const state = getPageState(currentPageIdRef.current);
      state.version = latestRemoteVersion;
      state.conflict = false;
      enqueueSave(currentPageIdRef.current).catch(() => {});
    },
  }));

  const handleStructuralMutation = useCallback(() => {
    if (isHistoryApplyingRef.current) return;

    const state = getPageState(currentPageIdRef.current);
    state.mutationRevision += 1;
    pushToHistory();
    scheduleAutoSave(currentPageIdRef.current);
  }, [getPageState, pushToHistory, scheduleAutoSave]);

  const handleTextTypingMutation = useCallback(() => {
    if (isHistoryApplyingRef.current) return;

    const state = getPageState(currentPageIdRef.current);
    state.mutationRevision += 1;
    scheduleAutoSave(currentPageIdRef.current);
  }, [getPageState, scheduleAutoSave]);

  const handlersRef = useRef({
    handleStructuralMutation,
    handleTextTypingMutation,
    pushToHistory,
  });

  useEffect(() => {
    handlersRef.current = {
      handleStructuralMutation,
      handleTextTypingMutation,
      pushToHistory,
    };
  });

  useEffect(() => {
    if (!canvasHostRef.current) return;

    const canvasElement = document.createElement('canvas');
    canvasHostRef.current.appendChild(canvasElement);

    const canvas = new fabric.Canvas(canvasElement, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: '#FFFFFF',
      preserveObjectStacking: true,
      selection: false,
      selectionKey: [],
    });

    fabricRef.current = canvas;

    const brush = new fabric.PencilBrush(canvas);
    brush.color = brushColor;
    brush.width = brushWidth;
    canvas.freeDrawingBrush = brush;

    canvas.on('object:modified', () =>
      handlersRef.current.handleStructuralMutation()
    );
    canvas.on('object:added', () =>
      handlersRef.current.handleStructuralMutation()
    );
    canvas.on('object:removed', () =>
      handlersRef.current.handleStructuralMutation()
    );
    canvas.on('text:changed', (event) => {
      if (event.target) constrainTextboxToCanvas(event.target);
      handlersRef.current.handleTextTypingMutation();
    });
    canvas.on('text:editing:exited', () =>
      handlersRef.current.pushToHistory()
    );

    let keyboardAlignmentTimer: ReturnType<typeof setTimeout> | null = null;

    const alignEditingTextAboveKeyboard = () => {
      const activeObject = canvas.getActiveObject();
      const visualViewport = window.visualViewport;
      if (!(activeObject instanceof fabric.IText) || !activeObject.isEditing || !visualViewport) {
        return;
      }

      const canvasRect = canvas.upperCanvasEl.getBoundingClientRect();
      const textBounds = activeObject.getBoundingRect();
      const visibleScale = canvasRect.width / CANVAS_WIDTH;
      const textBottom =
        canvasRect.top + (textBounds.top + textBounds.height) * visibleScale;
      const targetBottom = visualViewport.offsetTop + visualViewport.height - TEXT_KEYBOARD_GAP;

      window.scrollTo({
        left: 0,
        top: window.scrollY + textBottom - targetBottom,
        behavior: 'smooth',
      });
    };

    const scheduleKeyboardAlignment = () => {
      if (keyboardAlignmentTimer) clearTimeout(keyboardAlignmentTimer);
      keyboardAlignmentTimer = setTimeout(alignEditingTextAboveKeyboard, 180);
    };

    canvas.on('text:editing:entered', scheduleKeyboardAlignment);
    window.visualViewport?.addEventListener('resize', scheduleKeyboardAlignment);

    const keepTextInsideCanvas = (object: fabric.FabricObject) => {
      if (!(object instanceof fabric.IText)) return;

      object.setCoords();
      let bounds = object.getBoundingRect();

      if (bounds.width > CANVAS_WIDTH || bounds.height > CANVAS_HEIGHT) {
        const factor = Math.min(
          CANVAS_WIDTH / Math.max(bounds.width, 1),
          CANVAS_HEIGHT / Math.max(bounds.height, 1)
        );
        object.set({
          scaleX: (object.scaleX || 1) * factor,
          scaleY: (object.scaleY || 1) * factor,
        });
        object.setCoords();
        bounds = object.getBoundingRect();
      }

      let deltaX = 0;
      let deltaY = 0;
      if (bounds.left < 0) deltaX = -bounds.left;
      else if (bounds.left + bounds.width > CANVAS_WIDTH) {
        deltaX = CANVAS_WIDTH - (bounds.left + bounds.width);
      }
      if (bounds.top < 0) deltaY = -bounds.top;
      else if (bounds.top + bounds.height > CANVAS_HEIGHT) {
        deltaY = CANVAS_HEIGHT - (bounds.top + bounds.height);
      }

      if (deltaX || deltaY) {
        object.set({
          left: (object.left || 0) + deltaX,
          top: (object.top || 0) + deltaY,
        });
        object.setCoords();
      }
    };

    const syncSelectionState = () => {
      const activeObject = canvas.getActiveObject();
      setHasSelection(canvas.getActiveObjects().length > 0);
      if (activeObject) configureObjectControls(activeObject);
    };

    canvas.on('selection:created', syncSelectionState);
    canvas.on('selection:updated', syncSelectionState);

    let blankTapSnapshot: {
      object: fabric.FabricObject;
      left: number;
      top: number;
      scaleX: number;
      scaleY: number;
      angle: number;
    } | null = null;
    let suppressedSelectionTarget: fabric.FabricObject | null = null;
    let selectionTapLockedTarget: {
      object: fabric.FabricObject;
      lockMovementX: boolean;
      lockMovementY: boolean;
    } | null = null;
    canvas.on('mouse:down:before', (event) => {
      const activeObject = canvas.getActiveObject();
      const nextTarget = event.target;

      if (!activeObject && nextTarget) {
        selectionTapLockedTarget = {
          object: nextTarget,
          lockMovementX: nextTarget.lockMovementX,
          lockMovementY: nextTarget.lockMovementY,
        };
        nextTarget.set({ lockMovementX: true, lockMovementY: true });
      }

      if (activeObject && !nextTarget) {
        blankTapSnapshot = {
          object: activeObject,
          left: activeObject.left || 0,
          top: activeObject.top || 0,
          scaleX: activeObject.scaleX || 1,
          scaleY: activeObject.scaleY || 1,
          angle: activeObject.angle || 0,
        };
      }

      if (activeObject && nextTarget && nextTarget !== activeObject) {
        if (activeObject instanceof fabric.IText && activeObject.isEditing) {
          activeObject.exitEditing();
        }

        // Egy másik elem első érintése csak az előző kijelölést oldja fel.
        // Az érintett elem a következő külön koppintással választható ki.
        suppressedSelectionTarget = nextTarget;
        nextTarget.selectable = false;
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
    });
    canvas.on('selection:cleared', () => {
      if (blankTapSnapshot) {
        const { object, left, top, scaleX, scaleY, angle } = blankTapSnapshot;
        object.set({ left, top, scaleX, scaleY, angle });
        object.setCoords();
        canvas.requestRenderAll();
        blankTapSnapshot = null;
      }
      syncSelectionState();
    });
    canvas.on('mouse:up', () => {
      if (selectionTapLockedTarget) {
        const { object, lockMovementX, lockMovementY } = selectionTapLockedTarget;
        object.set({ lockMovementX, lockMovementY });
        object.setCoords();
        selectionTapLockedTarget = null;
      }
      if (suppressedSelectionTarget) {
        suppressedSelectionTarget.selectable = true;
        suppressedSelectionTarget = null;
      }
      blankTapSnapshot = null;
    });
    canvas.on('object:moving', (event) => {
      if (event.target) keepTextInsideCanvas(event.target);
    });
    canvas.on('object:modified', (event) => {
      if (event.target) keepTextInsideCanvas(event.target);
    });

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      if (keyboardAlignmentTimer) clearTimeout(keyboardAlignmentTimer);
      window.visualViewport?.removeEventListener('resize', scheduleKeyboardAlignment);

      canvas.dispose();
      fabricRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const previousPageId = currentPageIdRef.current;
    const isPageSwitch = previousPageId !== page.id;
    const activePageData = pageDataRef.current;

    const switchAndLoadPage = async () => {
      if (isPageSwitch) {
        const prevState = getPageState(previousPageId);

        if (
          (prevState.mutationRevision !== prevState.savedRevision ||
            prevState.pending) &&
          !prevState.conflict
        ) {
          if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
          }

          const snapshotJson = canvas.toJSON();
          const snapshotPreview = canvas.toDataURL({
            format: 'jpeg',
            quality: 0.8,
            multiplier: 1,
          });

          enqueueSave(
            previousPageId,
            snapshotJson,
            snapshotPreview,
            prevState.mutationRevision
          ).catch(() => {});
        }
      }

      if (loadAbortControllerRef.current) {
        loadAbortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      loadAbortControllerRef.current = abortController;

      currentPageIdRef.current = page.id;
      isHistoryApplyingRef.current = true;

      const currentState = getPageState(
        page.id,
        activePageData.version
      );

      try {
        if (currentState.pending) {
          await canvas.loadFromJSON(
            currentState.pending.json,
            undefined,
            { signal: abortController.signal }
          );
        } else if (
          activePageData.canvasData &&
          Object.keys(activePageData.canvasData).length > 0
        ) {
          await canvas.loadFromJSON(
            activePageData.canvasData,
            undefined,
            { signal: abortController.signal }
          );
        } else {
          canvas.clear();
          canvas.backgroundColor = '#FFFFFF';
        }

        if (abortController.signal.aborted) return;

        canvas.getObjects().forEach((object, index) => {
          let configuredObject = object;

          if (object instanceof fabric.IText && !(object instanceof fabric.Textbox)) {
            const replacement = new fabric.Textbox(object.text, {
              ...object.toObject(),
              width: Math.min(object.width || DEFAULT_TEXT_WIDTH, getTextboxMaxWidth(object)),
              splitByGrapheme: true,
            });
            canvas.remove(object);
            canvas.insertAt(index, replacement);
            configuredObject = replacement;
          }

          constrainTextboxToCanvas(configuredObject);
          configureObjectControls(configuredObject);
        });
        canvas.renderAll();

        const initialJson = JSON.stringify(canvas.toJSON());
        historyRef.current = [initialJson];
        historyIndexRef.current = 0;
        updateHistoryButtons();

        if (currentState.conflict) {
          setSaveStatus('conflict');
        } else {
          const isSynced =
            currentState.mutationRevision === currentState.savedRevision &&
            !currentState.pending;

          setSaveStatus(isSynced ? 'saved' : 'unsaved');
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Hiba az oldal betA�ltA�se kA�zben:', err);
        }
      } finally {
        if (!abortController.signal.aborted) {
          isHistoryApplyingRef.current = false;
        }
      }
    };

    switchAndLoadPage();

    return () => {
      if (loadAbortControllerRef.current) {
        loadAbortControllerRef.current.abort();
      }
    };
  }, [page.id, enqueueSave, getPageState, updateHistoryButtons]);

  useEffect(() => {
    const handleOnline = () => {
      const pageId = currentPageIdRef.current;
      const state = getPageState(pageId, pageDataRef.current.version);

      const hasUnsavedWork =
        state.mutationRevision !== state.savedRevision || Boolean(state.pending);

      if (!hasUnsavedWork || state.conflict || state.activeSavePromise) {
        return;
      }

      enqueueSave(pageId).catch(() => {
        // A sikertelen retry utA?n a pending/helyi A?llapot megmarad.
        // A�jabb prAlbA?lkozA?s a kA�vetkezL� online esemA�nynA�l vagy kA�zi mentA�snA�l lesz.
      });
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [enqueueSave, getPageState]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = isDrawing || isErasing;

    if (canvas.freeDrawingBrush) {
      const profile = brushTool === 'pen'
        ? { widthMultiplier: 1.15, alpha: 1 }
        : brushTool === 'pencil'
          ? { widthMultiplier: 0.55, alpha: 0.62 }
          : { widthMultiplier: 2.6, alpha: 0.72 };
      const selectedColor = brushColor.startsWith('#') && brushColor.length === 7
        ? (() => {
            const red = parseInt(brushColor.slice(1, 3), 16);
            const green = parseInt(brushColor.slice(3, 5), 16);
            const blue = parseInt(brushColor.slice(5, 7), 16);
            return 'rgba(' + red + ', ' + green + ', ' + blue + ', ' + profile.alpha + ')';
          })()
        : brushColor;
      canvas.freeDrawingBrush.color = isErasing ? '#FFFFFF' : selectedColor;
      canvas.freeDrawingBrush.width = isErasing
        ? eraserWidth
        : Math.max(1, Math.round(brushWidth * profile.widthMultiplier));
      (canvas.freeDrawingBrush as any).strokeLineCap = brushTool === 'brush' ? 'round' : 'butt';
    }
  }, [isDrawing, isErasing, brushColor, brushWidth, brushTool, eraserWidth]);

  const closeOpenToolMenus = () => {
    toolbarRef.current
      ?.querySelectorAll<HTMLDetailsElement>('details[open]')
      .forEach((detail) => detail.removeAttribute('open'));
  };

  const handleAddText = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // A szöveg beszúrása mindig kijelölési módra vált. Így a korábban
    // használt rajz vagy radír nem aktiválódik újra a szerkesztés végén.
    setIsDrawing(false);
    setIsErasing(false);
    canvas.isDrawingMode = false;
    closeOpenToolMenus();

    const textWidth = Math.min(newTextWidth * INITIAL_TEXTBOX_SIZE_SCALE, CANVAS_WIDTH - 32);

    const centerNewText = newTextAlign === 'center';
    const text = new fabric.Textbox(copy.textPlaceholder, {
      left: centerNewText ? CANVAS_WIDTH / 2 : (CANVAS_WIDTH - textWidth) / 2,
      top: newTextTop,
      originX: centerNewText ? 'center' : 'left',
      width: textWidth,
      fontFamily: 'sans-serif',
      fontSize: newTextFontSize,
      textAlign: newTextAlign,
      splitByGrapheme: true,
      fill: '#1F2937',
      editable: true,
      borderColor: '#2563eb',
      cornerColor: '#ffffff',
      cornerStrokeColor: '#2563eb',
      cornerStyle: 'circle',
      cornerSize: 20,
      transparentCorners: false,
      padding: 8,
      centeredRotation: true,
    });
    configureObjectControls(text);

    canvas.add(text);
    canvas.setActiveObject(text);

    pushToHistory();
    scheduleAutoSave(currentPageIdRef.current);

    // Az Asj szA�vegdoboz azonnal szerkeszthetL�:
    // az elsL� begA�pelt karakter a teljes placeholdert lecserA�li.
    text.enterEditing();
    text.selectAll();
    canvas.requestRenderAll();
  };

  const handleSelectMode = () => {
    const canvas = fabricRef.current;
    setIsDrawing(false);
    setIsErasing(false);

    if (!canvas) return;
    canvas.isDrawingMode = false;

    const activeObject = canvas.getActiveObject();
    if (activeObject instanceof fabric.IText && activeObject.isEditing) {
      activeObject.exitEditing();
      canvas.setActiveObject(activeObject);
    }

    canvas.requestRenderAll();
  };

  const readUploadedImage = async (file: File) => {
    if (!optimizeUploadedImages) {
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('IMAGE_READ_FAILED'));
        reader.readAsDataURL(file);
      });
    }

    const optimized = await optimizeGuestImage(file);
    setImageUploadMessage(optimized.mayBeLowResolutionForA5
      ? (language === 'de'
        ? 'Das Bild kann für einen A5-Druck eine zu niedrige Auflösung haben.'
        : language === 'en'
          ? 'This image may have insufficient resolution for A5 printing.'
          : 'A kép felbontása alacsony lehet A5-ös nyomtatáshoz.')
      : null);
    return optimized.dataUrl;
  };

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';

    if (!file || !fabricRef.current) return;

    const uploadTargetPageId = currentPageIdRef.current;
    setImageUploadMessage(null);

    try {
      const dataUrl = await readUploadedImage(file);
      if (uploadTargetPageId !== currentPageIdRef.current) return;
      const imgElement = new Image();

      imgElement.onload = () => {
        if (
          uploadTargetPageId !== currentPageIdRef.current ||
          !fabricRef.current
        ) {
          return;
        }

        const fabricImg = new fabric.FabricImage(imgElement, {
          left: 100,
          top: 100,
          cornerColor: '#3B82F6',
          cornerStyle: 'circle',
        });

        const width = fabricImg.width || 1;
        const height = fabricImg.height || 1;
        const scale = Math.min(
          MAX_IMAGE_INITIAL_DIM / width,
          MAX_IMAGE_INITIAL_DIM / height,
          1
        );

        fabricImg.scale(scale);
        fabricRef.current.add(fabricImg);
        fabricRef.current.setActiveObject(fabricImg);
        fabricRef.current.renderAll();
      };

      imgElement.src = dataUrl;
    } catch (error) {
      console.error('Image upload failed:', error);
      setImageUploadMessage(language === 'de'
        ? 'Das Bild konnte nicht verarbeitet werden. Bitte wählen Sie ein JPEG-, PNG- oder WebP-Bild.'
        : language === 'en'
          ? 'The image could not be processed. Please choose a JPEG, PNG or WebP image.'
          : 'A kép nem dolgozható fel. Válassz JPEG-, PNG- vagy WebP-képet.');
    }
  };

  const backgroundCopy = language === 'de'
    ? { color: 'Hintergrundfarbe', photo: 'Eigenes Bild', patterns: 'Hintergrundsammlung' }
    : language === 'en'
      ? { color: 'Background color', photo: 'Own image', patterns: 'Background collection' }
      : { color: 'Háttérszín', photo: 'Saját kép', patterns: 'Háttérgyűjtemény' };

  const activeDrawingToolName = brushTool === 'pen'
    ? (language === 'de' ? 'Stift' : language === 'en' ? 'Pen' : 'Toll')
    : brushTool === 'pencil'
      ? (language === 'de' ? 'Bleistift' : language === 'en' ? 'Pencil' : 'Ceruza')
      : (language === 'de' ? 'Pinsel' : language === 'en' ? 'Brush' : 'Ecset');
  const drawingColorLabel = language === 'de'
    ? `${activeDrawingToolName}farbe`
    : language === 'en'
      ? `${activeDrawingToolName} color`
      : `${activeDrawingToolName} színe`;
  const drawingWidthLabel = language === 'de'
    ? `${activeDrawingToolName}stärke`
    : language === 'en'
      ? `${activeDrawingToolName} thickness`
      : `${activeDrawingToolName} vastagsága`;
  const drawingColors = ['#111827', '#dc2626', '#2563eb', '#16a34a'];

  const applyBackground = (background: string | fabric.Gradient<'linear'>) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.set({ backgroundColor: background, backgroundImage: undefined });
    canvas.requestRenderAll();
    handleStructuralMutation();
  };

  const handleBackgroundImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !fabricRef.current) return;

    const uploadTargetPageId = currentPageIdRef.current;
    setImageUploadMessage(null);
    try {
      const dataUrl = await readUploadedImage(file);
      if (uploadTargetPageId !== currentPageIdRef.current) return;
      const imgElement = new Image();
      imgElement.onload = () => {
        const canvas = fabricRef.current;
        if (!canvas || uploadTargetPageId !== currentPageIdRef.current) return;
        const scale = Math.max(CANVAS_WIDTH / imgElement.width, CANVAS_HEIGHT / imgElement.height);
        const backgroundImage = new fabric.FabricImage(imgElement, {
          left: CANVAS_WIDTH / 2,
          top: CANVAS_HEIGHT / 2,
          originX: 'center',
          originY: 'center',
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: false,
        });
        canvas.set({ backgroundImage });
        canvas.requestRenderAll();
        handleStructuralMutation();
      };
      imgElement.src = dataUrl;
    } catch (error) {
      console.error('Background image upload failed:', error);
      setImageUploadMessage(language === 'de'
        ? 'Das Bild konnte nicht verarbeitet werden. Bitte wählen Sie ein JPEG-, PNG- oder WebP-Bild.'
        : language === 'en'
          ? 'The image could not be processed. Please choose a JPEG, PNG or WebP image.'
          : 'A kép nem dolgozható fel. Válassz JPEG-, PNG- vagy WebP-képet.');
    }
  };

  const applyBackgroundImage = (src: string) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const imgElement = new Image();
    imgElement.onload = () => {
      const currentCanvas = fabricRef.current;
      if (!currentCanvas) return;
      const scale = Math.max(CANVAS_WIDTH / imgElement.width, CANVAS_HEIGHT / imgElement.height);
      const backgroundImage = new fabric.FabricImage(imgElement, {
        left: CANVAS_WIDTH / 2,
        top: CANVAS_HEIGHT / 2,
        originX: 'center',
        originY: 'center',
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false,
      });
      currentCanvas.set({ backgroundImage });
      currentCanvas.requestRenderAll();
      handleStructuralMutation();
    };
    imgElement.src = src;
  };

  const handleDeleteSelected = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    canvas.remove(...activeObjects);
    canvas.discardActiveObject();
    canvas.renderAll();
  };

  const handleBringForward = () => {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();

    if (!canvas || !obj) return;

    canvas.bringObjectForward(obj);
    canvas.renderAll();
    handleStructuralMutation();
  };

  const handleSendBackwards = () => {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();

    if (!canvas || !obj) return;

    canvas.sendObjectBackwards(obj);
    canvas.renderAll();
    handleStructuralMutation();
  };

  const handleUndo = async () => {
    const canvas = fabricRef.current;

    if (!canvas || historyIndexRef.current <= 0) return;

    isHistoryApplyingRef.current = true;

    try {
      historyIndexRef.current -= 1;
      const targetJson = JSON.parse(
        historyRef.current[historyIndexRef.current]
      );

      await canvas.loadFromJSON(targetJson);
      canvas.renderAll();
      updateHistoryButtons();
    } finally {
      isHistoryApplyingRef.current = false;
    }

    const state = getPageState(currentPageIdRef.current);
    state.mutationRevision += 1;
    scheduleAutoSave(currentPageIdRef.current);
  };

  const handleRedo = async () => {
    const canvas = fabricRef.current;

    if (
      !canvas ||
      historyIndexRef.current >= historyRef.current.length - 1
    ) {
      return;
    }

    isHistoryApplyingRef.current = true;

    try {
      historyIndexRef.current += 1;
      const targetJson = JSON.parse(
        historyRef.current[historyIndexRef.current]
      );

      await canvas.loadFromJSON(targetJson);
      canvas.renderAll();
      updateHistoryButtons();
    } finally {
      isHistoryApplyingRef.current = false;
    }

    const state = getPageState(currentPageIdRef.current);
    state.mutationRevision += 1;
    scheduleAutoSave(currentPageIdRef.current);
  };

  return (
    <div
      style={{
        minHeight: compactLayout ? 'auto' : '100vh',
        width: '100%',
        maxWidth: '100vw',
        overflowX: 'hidden',
        touchAction: 'pan-y',
        background: '#f1f5f9',
        padding: compactLayout ? 0 : 16,
        boxSizing: 'border-box',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <style>{`
        textarea[data-fabric='textarea'] {
          position: fixed !important;
          left: 50% !important;
          top: 50% !important;
        }
        .memorybook-editor-toolbar button,
        .memorybook-editor-toolbar label {
          min-height: 44px;
          box-sizing: border-box;
          font-size: 14px;
          font-weight: 700;
        }
        .memorybook-editor-toolbar button {
          padding: 9px 12px;
        }
        .memorybook-editor-toolbar input[type='range'] {
          min-width: 120px;
          height: 44px;
        }
        .memorybook-draw-menu {
          width: 280px;
          min-width: 0 !important;
          box-sizing: border-box;
        }
        .memorybook-eraser-menu {
          width: 220px;
          min-width: 0 !important;
          box-sizing: border-box;
        }
        .memorybook-draw-tool {
          flex: 1 1 0;
          min-width: 0 !important;
          padding: 6px 8px !important;
          font-size: 28px !important;
          line-height: 1;
        }
        @media (max-width: 600px) {
          .memorybook-editor-toolbar .memorybook-draw-details[open],
          .memorybook-editor-toolbar .memorybook-eraser-details[open] {
            flex: 1 0 100%;
          }
          .memorybook-editor-toolbar .memorybook-draw-menu {
            position: static !important;
            transform: none !important;
            width: 100% !important;
            max-width: none;
            margin-top: 6px;
          }
          .memorybook-editor-toolbar .memorybook-eraser-menu {
            position: static !important;
            transform: none !important;
            width: 100% !important;
            margin-top: 6px;
          }
        }
      `}</style>

      <div
        ref={toolbarRef}
        className="memorybook-editor-toolbar"
        onClickCapture={(event) => {
          const summary = (event.target as HTMLElement).closest('summary');
          if (!summary) return;
          const keepOpen = new Set<HTMLElement>();
          let ancestor: HTMLElement | null = summary.parentElement;
          while (ancestor) {
            if (ancestor.tagName === 'DETAILS') keepOpen.add(ancestor);
            ancestor = ancestor.parentElement;
          }
          event.currentTarget.querySelectorAll('details[open]').forEach((detail) => {
            if (!keepOpen.has(detail as HTMLElement)) {
              detail.removeAttribute('open');
            }
          });
        }}
        style={{
          maxWidth: 850,
          margin: compactLayout ? '0 auto 6px' : '0 auto 16px',
          padding: compactLayout ? 8 : 12,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          display: 'flex',
          flexWrap: 'wrap',
          gap: compactLayout ? 6 : 8,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: compactLayout ? 6 : 8, alignItems: 'center' }}>
          <button type="button" onClick={handleAddText} aria-label={language === 'de' ? 'Text hinzufügen' : language === 'en' ? 'Add text' : 'Szöveg hozzáadása'}>
            {language === 'de' ? 'Text' : language === 'en' ? 'Text' : 'Szöveg'}
          </button>

          <details style={{ position: 'relative' }}>
            <summary style={editorStyles.toolSummary}>{language === 'de' ? 'Bild' : language === 'en' ? 'Image' : 'Kép'}</summary>
            <div style={editorStyles.toolMenu}>
              <label style={editorStyles.toolMenuItem}>{language === 'de' ? '📷 Kamera' : language === 'en' ? '📷 Camera' : '📷 Fényképezőgép'}<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleImageUpload} /></label>
              <label style={editorStyles.toolMenuItem}>{language === 'de' ? '🖼 Eigenes Bild' : language === 'en' ? '🖼 Own image' : '🖼 Saját kép választása'}<input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} /></label>
            </div>
          </details>

          {enableBackgroundControls && (
            <details style={{ position: 'relative' }}>
              <summary style={editorStyles.toolSummary}>{language === 'de' ? 'Hintergrund' : language === 'en' ? 'Background' : 'Háttér'}</summary>
              <div style={editorStyles.toolMenu}>
                <label style={editorStyles.toolMenuItem}>{language === 'de' ? '📷 Kamera' : language === 'en' ? '📷 Camera' : '📷 Fényképezőgép'}<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleBackgroundImageUpload} /></label>
                <label style={editorStyles.toolMenuItem}>{backgroundCopy.photo}<input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBackgroundImageUpload} /></label>
                <details>
                  <summary style={editorStyles.toolMenuItem}>{backgroundCopy.patterns}</summary>
                  <div style={editorStyles.collectionMenu}>
                    {COVER_BACKGROUND_COLLECTION.map((background) => {
                      const name = background[language];
                      return <button key={background.id} type="button" onClick={(event) => { applyBackgroundImage(background.src); event.currentTarget.closest('details')?.parentElement?.closest('details')?.removeAttribute('open'); }} aria-label={name} title={name} style={editorStyles.collectionButton}><img src={background.src} alt="" style={{ display: 'block', width: '100%', aspectRatio: '750 / 1064', objectFit: 'cover', borderRadius: 5 }} /><span style={{ display: 'block', marginTop: 5, fontSize: 12 }}>{name}</span></button>;
                    })}
                  </div>
                </details>
                <label style={editorStyles.toolMenuItem}>{backgroundCopy.color}<input type="color" defaultValue="#0f172a" onChange={(event) => applyBackground(event.target.value)} style={{ width: 30, height: 30, padding: 0, border: 0 }} /></label>
              </div>
            </details>
          )}

          <details className="memorybook-draw-details" style={{ position: 'relative' }}>
            <summary style={editorStyles.toolSummary}>{language === 'de' ? 'Zeichnen' : language === 'en' ? 'Draw' : 'Rajz'}</summary>
            <div className="memorybook-draw-menu" style={{ ...editorStyles.toolMenu, gap: 8 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap' }}>
                {([
                  ['pen', language === 'de' ? 'Stift' : language === 'en' ? 'Pen' : 'Toll', '🖊️'],
                  ['pencil', language === 'de' ? 'Bleistift' : language === 'en' ? 'Pencil' : 'Ceruza', '✏️'],
                  ['brush', language === 'de' ? 'Pinsel' : language === 'en' ? 'Brush' : 'Ecset', '🖌️'],
                ] as const).map(([tool, label, icon]) => (
                  <button
                    key={tool}
                    type="button"
                    className="memorybook-draw-tool"
                    aria-label={label}
                    title={label}
                    aria-pressed={brushTool === tool && isDrawing}
                    onClick={() => {
                      fabricRef.current?.discardActiveObject();
                      fabricRef.current?.requestRenderAll();
                      setBrushTool(tool);
                      setIsErasing(false);
                      setIsDrawing(true);
                    }}
                    style={{ background: brushTool === tool && isDrawing ? '#dbeafe' : '#fff' }}
                  >
                    <span aria-hidden="true">{icon}</span>
                  </button>
                ))}
              </div>
              <div style={{ ...editorStyles.toolMenuItem, display: 'grid', gap: 7 }}>
                <span>{drawingColorLabel}</span>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  {drawingColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      title={color}
                      onClick={() => setBrushColor(color)}
                      style={{
                        width: 32,
                        height: 32,
                        minHeight: 32,
                        padding: 0,
                        borderRadius: '50%',
                        border: brushColor === color ? '3px solid #0f172a' : '2px solid #cbd5e1',
                        background: color,
                        boxShadow: brushColor === color ? '0 0 0 2px #fff inset' : 'none',
                      }}
                    />
                  ))}
                  <input
                    type="color"
                    aria-label={language === 'de' ? 'Eigene Farbe' : language === 'en' ? 'Custom color' : 'Egyedi szín'}
                    title={language === 'de' ? 'Eigene Farbe' : language === 'en' ? 'Custom color' : 'Egyedi szín'}
                    value={brushColor}
                    onChange={(event) => setBrushColor(event.target.value)}
                    style={{ width: 36, height: 36, minHeight: 36, padding: 2, border: '2px solid #cbd5e1', borderRadius: 6, background: '#fff' }}
                  />
                </div>
              </div>
              <label style={{ ...editorStyles.toolMenuItem, display: 'grid', gap: 7 }}>
                <span>{drawingWidthLabel}</span>
                <input type="range" aria-label={drawingWidthLabel} min="1" max="25" value={brushWidth} onChange={(e) => setBrushWidth(Number(e.target.value))} style={{ width: '100%', minWidth: 0 }} />
              </label>
              <button
                type="button"
                onClick={() => {
                  setIsDrawing(false);
                  setIsErasing(false);
                  const canvas = fabricRef.current;
                  if (canvas) {
                    canvas.isDrawingMode = false;
                    canvas.discardActiveObject();
                    canvas.requestRenderAll();
                  }
                  closeOpenToolMenus();
                }}
              >
                {copy.stopDrawing}
              </button>
            </div>
          </details>
          <details
            className="memorybook-eraser-details"
            style={{ position: 'relative' }}
            onToggle={(event) => {
              if (event.currentTarget.open) {
                setIsErasing(true);
                setIsDrawing(false);
                fabricRef.current?.discardActiveObject();
                fabricRef.current?.requestRenderAll();
              }
            }}
          >
            <summary style={{ ...editorStyles.toolSummary, background: isErasing ? '#dbeafe' : '#fff' }}>
              {copy.eraser}
            </summary>
            <div className="memorybook-eraser-menu" style={{ ...editorStyles.toolMenu, gap: 8 }}>
              <label style={{ ...editorStyles.toolMenuItem, display: 'grid', gap: 7 }}>
                <span>{language === 'de' ? 'Radierergröße' : language === 'en' ? 'Eraser size' : 'Radír mérete'}</span>
                <input
                  type="range"
                  aria-label={language === 'de' ? 'Radierergröße' : language === 'en' ? 'Eraser size' : 'Radír mérete'}
                  min="8"
                  max="80"
                  value={eraserWidth}
                  onChange={(event) => setEraserWidth(Number(event.target.value))}
                  style={{ width: '100%', minWidth: 0 }}
                />
              </label>
            </div>
          </details>
          <button onClick={handleSelectMode} aria-pressed={!isDrawing && !isErasing}>{copy.select}</button>

          {compactLayout && (<><button onClick={handleUndo} disabled={!canUndo} aria-label={copy.undo}>↩</button><button onClick={handleRedo} disabled={!canRedo} aria-label={copy.redo}>↪</button><strong translate="no" style={{ whiteSpace: 'nowrap' }}>{saveStatus === 'saved' ? copy.saved : saveStatus === 'saving' ? copy.saving : saveStatus === 'conflict' ? copy.conflict : copy.unsaved}</strong></>)}



          {hasSelection && (<><button onClick={handleBringForward}>{copy.bringForward}</button><button onClick={handleSendBackwards}>{copy.sendBackward}</button><button onClick={handleDeleteSelected}>{copy.delete}</button></>)}
        </div>

        {!compactLayout && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button onClick={handleUndo} disabled={!canUndo} aria-label={copy.undo}>
            ↩
          </button>
          <button onClick={handleRedo} disabled={!canRedo} aria-label={copy.redo}>
            ↪
          </button>

          <strong translate="no">
            {saveStatus === 'saved'
              ? copy.saved
              : saveStatus === 'saving'
                ? copy.saving
                : saveStatus === 'conflict'
                  ? copy.conflict
                  : copy.unsaved}
          </strong>

        </div>}
      </div>

      {imageUploadMessage && (
        <div role="status" style={{ maxWidth: 850, margin: '0 auto 10px', padding: '10px 12px', border: '1px solid #f59e0b', borderRadius: 8, background: '#fffbeb', color: '#92400e', fontWeight: 700 }}>
          {imageUploadMessage}
        </div>
      )}

      <div
        ref={canvasViewportRef}
        style={{
          width: '100%',
          maxWidth: CANVAS_WIDTH,
          margin: '0 auto',
          overflowX: 'hidden',
        }}
      >
        <div
          data-testid="memorybook-canvas-frame"
          style={{
            width: CANVAS_WIDTH * canvasScale,
            height: CANVAS_HEIGHT * canvasScale,
            margin: '0 auto',
            background: '#fff',
            border: '1px solid #cbd5e1',
            boxShadow: '0 10px 30px rgba(0,0,0,.12)',
            overflow: 'hidden',
            touchAction: isDrawing || isErasing || hasSelection ? 'none' : 'manipulation',
          }}
        >
          <div
            ref={canvasHostRef}
            style={{
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              transform: `scale(${canvasScale})`,
              transformOrigin: 'top left',
            }}
          />
        </div>
      </div>
    </div>
  );
});

MemoryBookEditor.displayName = 'MemoryBookEditor';
