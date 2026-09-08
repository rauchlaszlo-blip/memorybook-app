import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import * as fabric from 'fabric';

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

export const MemoryBookEditor = forwardRef<
  MemoryBookEditorRef,
  MemoryBookEditorProps
>(({ page, onSavePage, onConflict }, ref) => {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [brushColor, setBrushColor] = useState('#1F2937');
  const [brushWidth, setBrushWidth] = useState(5);
  const [saveStatus, setSaveStatus] = useState<
    'saved' | 'saving' | 'unsaved' | 'conflict'
  >('saved');
  const [hasSelection, setHasSelection] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [canvasScale, setCanvasScale] = useState(1);

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
      setCanvasScale(Math.min(1, availableWidth / CANVAS_WIDTH));
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
  }, []);

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
    canvas.on('text:changed', () =>
      handlersRef.current.handleTextTypingMutation()
    );
    canvas.on('text:editing:exited', () =>
      handlersRef.current.pushToHistory()
    );

    canvas.on('selection:created', () =>
      setHasSelection(
        (fabricRef.current?.getActiveObjects().length ?? 0) > 0
      )
    );
    canvas.on('selection:updated', () =>
      setHasSelection(
        (fabricRef.current?.getActiveObjects().length ?? 0) > 0
      )
    );
    canvas.on('selection:cleared', () => setHasSelection(false));

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

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
      canvas.freeDrawingBrush.color = isErasing ? '#FFFFFF' : brushColor;
      canvas.freeDrawingBrush.width = isErasing ? Math.max(brushWidth * 2, 12) : brushWidth;
    }
  }, [isDrawing, isErasing, brushColor, brushWidth]);

  const handleAddText = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const text = new fabric.IText('Írd ide a gondolataidat...', {
      left: CANVAS_WIDTH / 2 - 140,
      top: 150,
      fontFamily: 'sans-serif',
      fontSize: 22,
      fill: '#1F2937',
      editable: true,
    });

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

  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];

    if (!file || !fabricRef.current) return;

    const uploadTargetPageId = currentPageIdRef.current;
    const reader = new FileReader();

    reader.onload = (event) => {
      if (uploadTargetPageId !== currentPageIdRef.current) return;

      const dataUrl = event.target?.result as string;
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
    };

    reader.readAsDataURL(file);
    e.target.value = '';
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
        minHeight: '100vh',
        background: '#f1f5f9',
        padding: 16,
        boxSizing: 'border-box',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <style>{`
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
      `}</style>

      <div
        className="memorybook-editor-toolbar"
        style={{
          maxWidth: 850,
          margin: '0 auto 16px',
          padding: 12,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button onClick={handleAddText}>+ Szöveg</button>

          <label
            style={{
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              padding: '6px 10px',
              cursor: 'pointer',
              background: '#fff',
            }}
          >
            + Fotó
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageUpload}
            />
          </label>

          <button
            onClick={() => {
              setIsDrawing((prev) => !prev);
              setIsErasing(false);
            }}
          >
            {isDrawing ? 'Rajz leállítása' : 'Szabadkézi rajz'}
          </button>

          <button
            onClick={() => {
              setIsErasing((prev) => !prev);
              setIsDrawing(false);
            }}
          >
            {isErasing ? 'Radír leállítása' : 'Radír'}
          </button>

          {(isDrawing || isErasing) && (
            <>
              {!isErasing && (
                <input
                  type="color"
                  value={brushColor}
                  onChange={(e) => setBrushColor(e.target.value)}
                />
              )}
              <input
                type="range"
                min="1"
                max="25"
                value={brushWidth}
                onChange={(e) => setBrushWidth(Number(e.target.value))}
              />
            </>
          )}

          {hasSelection && (
            <>
              <button onClick={handleBringForward}>↑ Előre</button>
              <button onClick={handleSendBackwards}>↓ Hátra</button>
              <button onClick={handleDeleteSelected}>Törlés</button>
            </>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button onClick={handleUndo} disabled={!canUndo}>
            ↩
          </button>
          <button onClick={handleRedo} disabled={!canRedo}>
            ↪
          </button>

          <strong translate="no">
            {saveStatus === 'saved'
              ? '✓ Mentve'
              : saveStatus === 'saving'
                ? 'Mentés...'
                : saveStatus === 'conflict'
                  ? '⚠ Ütközés'
                  : 'Nem mentett'}
          </strong>

          <button
            onClick={() =>
              enqueueSave(currentPageIdRef.current).catch(() => {})
            }
            disabled={
              saveStatus === 'saved' ||
              saveStatus === 'saving' ||
              saveStatus === 'conflict'
            }
          >
            Mentés most
          </button>
        </div>
      </div>

      <div
        ref={canvasViewportRef}
        style={{
          width: '100%',
          maxWidth: CANVAS_WIDTH,
          margin: '0 auto',
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
            touchAction: isDrawing || isErasing ? 'none' : 'manipulation',
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

