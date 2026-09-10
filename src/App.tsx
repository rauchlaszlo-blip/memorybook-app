import { JoinPage } from './JoinPage';
import { OrganizerContributionsPage } from './OrganizerContributionsPage';
import { BookViewerPage } from './BookViewerPage';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import {
  MemoryBookEditor,
  type MemoryBookEditorRef,
  type PageData,
} from './MemoryBookEditor';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://' + window.location.hostname + ':3001' : '';
const DEMO_BOOK_ID = 'book-12b';
const PAGE_IDS = ['page-1', 'page-2'];

type WebMcpStatus = 'checking' | 'available' | 'unavailable' | 'error';

function App() {
  const joinMatch = window.location.pathname.match(/^\/join\/([^/]+)$/);

  if (joinMatch) {
    return <JoinPage token={decodeURIComponent(joinMatch[1])} />;
  }

  const organizerMatch = window.location.pathname.match(
    /^\/organizer\/([^/]+)\/contributions$/
  );

  if (organizerMatch) {
    return (
      <OrganizerContributionsPage
        bookId={decodeURIComponent(organizerMatch[1])}
      />
    );
  }

  const bookViewMatch = window.location.pathname.match(
    /^\/book\/([^/]+)\/view$/
  );

  if (bookViewMatch) {
    return (
      <BookViewerPage
        bookId={decodeURIComponent(bookViewMatch[1])}
      />
    );
  }

  const editorRef = useRef<MemoryBookEditorRef>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [pageIds, setPageIds] = useState<string[]>(PAGE_IDS);
  const pageIdsRef = useRef<string[]>(PAGE_IDS);
  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const [webMcpStatus, setWebMcpStatus] =
    useState<WebMcpStatus>('checking');
  const [webMcpTestResult, setWebMcpTestResult] =
    useState<string | null>(null);

  const currentPageId = pageIds[currentIndex];

  useEffect(() => {
    const loadPageOrder = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/books/${encodeURIComponent(DEMO_BOOK_ID)}/pages`);

        if (!response.ok) {
          throw new Error(`PAGE_LIST_LOAD_FAILED_${response.status}`);
        }

        const data = await response.json();
        const ids = Array.isArray(data.pages)
          ? data.pages.map((item: any) => String(item.id))
          : [];

        if (ids.length > 0) {
          pageIdsRef.current = ids;
          setPageIds(ids);
        }
      } catch (err) {
        console.error('Oldalsorrend betöltési hiba:', err);
      }
    };

    loadPageOrder();
  }, []);
  const currentIndexRef = useRef(currentIndex);
  const currentPageIdRef = useRef(currentPageId);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
    currentPageIdRef.current = currentPageId;
  }, [currentIndex, currentPageId]);

  useEffect(() => {
    const modelContext = (document as any).modelContext;

    if (!modelContext || typeof modelContext.registerTool !== 'function') {
      setWebMcpStatus('unavailable');
      return;
    }

    const controller = new AbortController();

    const registerWebMcpTool = async () => {
      try {
        await modelContext.registerTool(
          {
            name: 'get_memorybook_status',
            title: 'Get MemoryBook Status',
            description:
              'Returns a simple read-only status of the currently open MemoryBook demo.',
            inputSchema: {
              type: 'object',
              properties: {
                test: {
                  type: 'string',
                  description: 'Simple test value.',
                },
              },
              required: ['test'],
              additionalProperties: false,
            },
            annotations: {
              readOnlyHint: true,
            },
            execute: async () => {
              return {
                application: 'MemoryBook',
                status: 'running',
                currentPageId: currentPageIdRef.current,
                currentPageNumber: currentIndexRef.current + 1,
                totalPages: pageIdsRef.current.length,
                message: 'MemoryBook WebMCP connection is working.',
              };
            },
          },
          {
            signal: controller.signal,
          }
        );

        await modelContext.registerTool(
          {
            name: 'get_book_context',
            title: 'Get Book Context',
            description:
              'Returns semantic context about a MemoryBook book, its pages and contributed memories. Does not expose raw Fabric canvas JSON.',
            inputSchema: {
              type: 'object',
              properties: {
                bookId: {
                  type: 'string',
                  description: 'MemoryBook book ID, for example book-12b.',
                },
              },
              required: ['bookId'],
              additionalProperties: false,
            },
            annotations: {
              readOnlyHint: true,
            },
            execute: async (input: any) => {
              const bookId =
                typeof input?.bookId === 'string'
                  ? input.bookId
                  : 'book-12b';

              const contributionsResponse = await fetch(
                `${API_BASE}/api/books/${encodeURIComponent(bookId)}/contributions`
              );

              if (!contributionsResponse.ok) {
                throw new Error(
                  `BOOK_CONTEXT_LOAD_FAILED_${contributionsResponse.status}`
                );
              }

              const contributionsData =
                await contributionsResponse.json();

              const pageResults = await Promise.all(
                pageIdsRef.current.map(async (pageId) => {
                  const response = await fetch(
                    `${API_BASE}/api/pages/${encodeURIComponent(pageId)}`
                  );

                  if (!response.ok) {
                    return {
                      id: pageId,
                      available: false,
                    };
                  }

                  const pageData = await response.json();

                  return {
                    id: pageData.id,
                    pageNumber: pageData.pageNumber,
                    version: pageData.version,
                    hasPreview: Boolean(pageData.previewImageUrl),
                    hasContent: Boolean(
                      pageData.canvasData &&
                        Object.keys(pageData.canvasData).length > 0
                    ),
                  };
                })
              );

              const contributions = contributionsData.contributions ?? [];

              return {
                application: 'MemoryBook',
                book: {
                  id: contributionsData.book.id,
                  title: contributionsData.book.title,
                },
                pages: pageResults,
                totalPages: pageResults.length,
                contributions: {
                  total: contributions.length,
                  withPhoto: contributions.filter(
                    (item: any) => Boolean(item.photoUrl)
                  ).length,
                  withoutPhoto: contributions.filter(
                    (item: any) => !item.photoUrl
                  ).length,
                },
                currentEditorPage: {
                  id: currentPageIdRef.current,
                  pageNumber: currentIndexRef.current + 1,
                },
              };
            },
          },
          {
            signal: controller.signal,
          }
        );

        await modelContext.registerTool(
          {
            name: 'list_contributions',
            title: 'List Contributions',
            description:
              'Returns submitted MemoryBook contributions for a book in semantic form. Read-only. Does not expose raw Fabric canvas data.',
            inputSchema: {
              type: 'object',
              properties: {
                bookId: {
                  type: 'string',
                  description: 'MemoryBook book ID, for example book-12b.',
                },
              },
              required: ['bookId'],
              additionalProperties: false,
            },
            annotations: {
              readOnlyHint: true,
            },
            execute: async (input: any) => {
              const bookId =
                typeof input?.bookId === 'string'
                  ? input.bookId
                  : 'book-12b';

              const response = await fetch(
                `${API_BASE}/api/books/${encodeURIComponent(bookId)}/contributions`
              );

              if (!response.ok) {
                throw new Error(
                  `CONTRIBUTIONS_LOAD_FAILED_${response.status}`
                );
              }

              const data = await response.json();

              return {
                application: 'MemoryBook',
                book: {
                  id: data.book.id,
                  title: data.book.title,
                },
                total: data.contributions.length,
                contributions: data.contributions.map((item: any) => ({
                  id: item.id,
                  contributorName: item.contributorName,
                  memoryText: item.memoryText,
                  hasPhoto: Boolean(item.photoUrl),
                  photoUrl: item.photoUrl ?? null,
                  createdAt: item.createdAt,
                })),
              };
            },
          },
          {
            signal: controller.signal,
          }
        );

        await modelContext.registerTool(
          {
            name: 'get_event_coverage',
            title: 'Get Event Coverage',
            description:
              'Returns coverage of important school-year events based on submitted MemoryBook contributions. Read-only.',
            inputSchema: {
              type: 'object',
              properties: {
                bookId: {
                  type: 'string',
                  description: 'MemoryBook book ID, for example book-12b.',
                },
              },
              required: ['bookId'],
              additionalProperties: false,
            },
            annotations: {
              readOnlyHint: true,
            },
            execute: async (input: any) => {
              const bookId =
                typeof input?.bookId === 'string'
                  ? input.bookId
                  : 'book-12b';

              const response = await fetch(
                `${API_BASE}/api/books/${encodeURIComponent(bookId)}/contributions`
              );

              if (!response.ok) {
                throw new Error(
                  `EVENT_COVERAGE_LOAD_FAILED_${response.status}`
                );
              }

              const data = await response.json();
              const contributions = data.contributions ?? [];

              const events = [
                {
                  id: 'class-trip',
                  title: 'Class trip',
               keywords: ['class trip', 'trip', 'bus', 'osztálykirándulás', 'kirándulás'],  
                },
                {
                  id: 'sports-day',
                  title: 'Sports day',
                  keywords: ['sports day', 'relay'],
                },
                {
                  id: 'school-play',
                  title: 'School play',
                  keywords: ['school play', 'backstage'],
                },
                {
                  id: 'christmas-party',
                  title: 'Christmas party',
                  keywords: ['christmas party', 'cake'],
                },
                {
                  id: 'chemistry-experiment',
                  title: 'Chemistry experiment',
                  keywords: ['chemistry', 'experiment'],
                },
                {
                  id: 'school-picnic',
                  title: 'School picnic',
                  keywords: ['picnic', 'shelter'],
                },
                {
                  id: 'graduation',
                  title: 'Graduation',
                  keywords: ['graduation', 'graduation rehearsal', 'ballagás', 'ballagási'],
                },
                {
                  id: 'first-day',
                  title: 'First day of 12th grade',
                  keywords: ['first day', '12th grade'],
                },
                {
                  id: 'winter-break',
                  title: 'Last day before winter break',
                  keywords: ['winter break'],
                },
                {
                  id: 'prom',
                  title: 'Prom / school ball',
                 keywords: ['prom', 'school ball', 'dance', 'szalagavató'],
                },
                {
                  id: 'final-exam',
                  title: 'Final exams',
                  keywords: ['final exam', 'final exams', 'exam week'],
                },
              ];

              const coverage = events.map((event) => {
                const matches = contributions.filter((item: any) => {
                  const text = String(item.memoryText ?? '').toLowerCase();

                  return event.keywords.some((keyword) =>
                    text.includes(keyword.toLowerCase())
                  );
                });

                return {
                  eventId: event.id,
                  title: event.title,
                  status: matches.length > 0 ? 'covered' : 'missing',
                  contributionCount: matches.length,
                  contributionIds: matches.map((item: any) => item.id),
                  contributors: matches.map(
                    (item: any) => item.contributorName
                  ),
                };
              });

              return {
                application: 'MemoryBook',
                book: {
                  id: data.book.id,
                  title: data.book.title,
                },
                summary: {
                  totalEvents: coverage.length,
                  coveredEvents: coverage.filter(
                    (item) => item.status === 'covered'
                  ).length,
                  missingEvents: coverage.filter(
                    (item) => item.status === 'missing'
                  ).length,
                },
                events: coverage,
              };
            },
          },
          {
            signal: controller.signal,
          }
        );

        await modelContext.registerTool(
          {
            name: 'build_thematic_spread',
            title: 'Build Thematic Spread',
            description:
              'Builds a deterministic MemoryBook page from approved submitted memories. Requires explicit human approval before writing.',
            inputSchema: {
              type: 'object',
              properties: {
                bookId: {
                  type: 'string',
                  description: 'MemoryBook book ID.',
                },
                targetPageId: {
                  type: 'string',
                  description: 'Target page ID, for example page-2.',
                },
                expectedVersion: {
                  type: 'integer',
                  minimum: 1,
                  description: 'Current target page version.',
                },
                theme: {
                  type: 'string',
                  description: 'Semantic theme of the page.',
                },
                title: {
                  type: 'string',
                  description: 'Page title.',
                },
                contributionIds: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                  minItems: 1,
                  description:
                    'IDs of submitted memories to place on the page.',
                },
                layout: {
                  type: 'string',
                  enum: ['hero_quote', 'two_memories'],
                  description:
                    'Deterministic MemoryBook layout. The agent does not supply coordinates.',
                },
                approved: {
                  type: 'boolean',
                  description:
                    'Must be true only after explicit human approval.',
                },
              },
              required: [
                'bookId',
                'targetPageId',
                'expectedVersion',
                'theme',
                'title',
                'contributionIds',
                'layout',
                'approved',
              ],
              additionalProperties: false,
            },
            execute: async (input: any) => {
              if (input?.approved !== true) {
                throw new Error('HUMAN_APPROVAL_REQUIRED');
              }

              const bookId = String(input.bookId ?? '');
              const targetPageId = String(input.targetPageId ?? '');
              const expectedVersion = Number(input.expectedVersion);
              const theme = String(input.theme ?? '').trim();
              const title = String(input.title ?? '').trim();
              const contributionIds = Array.isArray(
                input.contributionIds
              )
                ? input.contributionIds.map((id: any) => String(id))
                : [];
              const layout = String(input.layout ?? '');

              if (!bookId || !targetPageId || !theme || !title) {
                throw new Error('INVALID_BUILD_INPUT');
              }

              if (
                !Number.isInteger(expectedVersion) ||
                expectedVersion < 1
              ) {
                throw new Error('INVALID_EXPECTED_VERSION');
              }

              if (
                layout !== 'hero_quote' &&
                layout !== 'two_memories'
              ) {
                throw new Error('INVALID_LAYOUT');
              }

              const contributionsResponse = await fetch(
                `${API_BASE}/api/books/${encodeURIComponent(
                  bookId
                )}/contributions`
              );

              if (!contributionsResponse.ok) {
                throw new Error(
                  `CONTRIBUTIONS_LOAD_FAILED_${contributionsResponse.status}`
                );
              }

              const contributionsData =
                await contributionsResponse.json();

              const requestedContributions =
                contributionIds.map((id: string) => {
                  const found =
                    contributionsData.contributions.find(
                      (item: any) => item.id === id
                    );

                  if (!found) {
                    throw new Error(
                      `CONTRIBUTION_NOT_FOUND_${id}`
                    );
                  }

                  return found;
                });

              if (
                layout === 'two_memories' &&
                requestedContributions.length < 2
              ) {
                throw new Error(
                  'TWO_MEMORIES_REQUIRES_TWO_CONTRIBUTIONS'
                );
              }

              const makeText = (
                text: string,
                left: number,
                top: number,
                fontSize: number,
                fill: string,
                fontWeight = 'normal'
              ) => ({
                top,
                fill,
                left,
                text,
                type: 'IText',
                angle: 0,
                flipX: false,
                flipY: false,
                skewX: 0,
                skewY: 0,
                scaleX: 1,
                scaleY: 1,
                shadow: null,
                stroke: null,
                styles: [],
                opacity: 1,
                originX: 'left',
                originY: 'top',
                version: '7.4.0',
                visible: true,
                fillRule: 'nonzero',
                fontSize,
                overline: false,
                direction: 'ltr',
                fontStyle: 'normal',
                textAlign: 'left',
                underline: false,
                fontFamily: 'sans-serif',
                fontWeight,
                lineHeight: 1.16,
                paintFirst: 'fill',
                charSpacing: 0,
                linethrough: false,
                strokeWidth: 1,
                strokeLineCap: 'butt',
                strokeUniform: false,
                strokeLineJoin: 'miter',
                backgroundColor: '',
                strokeDashArray: null,
                strokeDashOffset: 0,
                strokeMiterLimit: 4,
                textBackgroundColor: '',
                globalCompositeOperation: 'source-over',
              });

              const wrapText = (
                value: string,
                maxChars: number
              ) => {
                const words = value.split(/\s+/);
                const lines: string[] = [];
                let line = '';

                for (const word of words) {
                  const candidate = line
                    ? `${line} ${word}`
                    : word;

                  if (
                    candidate.length > maxChars &&
                    line.length > 0
                  ) {
                    lines.push(line);
                    line = word;
                  } else {
                    line = candidate;
                  }
                }

                if (line) {
                  lines.push(line);
                }

                return lines.join('\n');
              };

              const objects: any[] = [
                makeText(
                  title,
                  60,
                  60,
                  36,
                  '#1F2937',
                  'bold'
                ),
                makeText(
                  theme,
                  60,
                  115,
                  18,
                  '#6B7280'
                ),
              ];

              if (layout === 'hero_quote') {
                const memory = requestedContributions[0];

                objects.push(
                  makeText(
                    wrapText(memory.memoryText, 42),
                    70,
                    230,
                    30,
                    '#111827'
                  )
                );

                objects.push(
                  makeText(
                    `— ${memory.contributorName}`,
                    70,
                    760,
                    22,
                    '#4B5563',
                    'bold'
                  )
                );
              }

              if (layout === 'two_memories') {
                const first = requestedContributions[0];
                const second = requestedContributions[1];

                objects.push(
                  makeText(
                    wrapText(first.memoryText, 52),
                    65,
                    210,
                    23,
                    '#111827'
                  )
                );

                objects.push(
                  makeText(
                    `— ${first.contributorName}`,
                    65,
                    425,
                    18,
                    '#4B5563',
                    'bold'
                  )
                );

                objects.push(
                  makeText(
                    wrapText(second.memoryText, 52),
                    65,
                    555,
                    23,
                    '#111827'
                  )
                );

                objects.push(
                  makeText(
                    `— ${second.contributorName}`,
                    65,
                    770,
                    18,
                    '#4B5563',
                    'bold'
                  )
                );
              }

              const makeImageObject = async (
                photoUrl: string,
                left: number,
                top: number,
                maxWidth: number,
                maxHeight: number
              ) => {
                const imageUrl = /^https?:\/\//i.test(photoUrl)
                  ? photoUrl
                  : `${API_BASE}${
                      photoUrl.startsWith('/') ? '' : '/'
                    }${photoUrl}`;

                const imgElement = await new Promise<HTMLImageElement>(
                  (resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';

                    img.onload = () => resolve(img);
                    img.onerror = () =>
                      reject(
                        new Error(
                          `CONTRIBUTION_IMAGE_LOAD_FAILED_${imageUrl}`
                        )
                      );

                    img.src = imageUrl;
                  }
                );

                const fabricImg = new fabric.FabricImage(imgElement, {
                  left,
                  top,
                  originX: 'left',
                  originY: 'top',
                });

                const width = fabricImg.width || 1;
                const height = fabricImg.height || 1;

                const scale = Math.min(
                  maxWidth / width,
                  maxHeight / height,
                  1
                );

                fabricImg.scale(scale);

                return fabricImg.toObject();
              };

              if (layout === 'hero_quote') {
                const memory = requestedContributions[0];

                if (memory.photoUrl) {
                  objects.push(
                    await makeImageObject(
                      memory.photoUrl,
                      175,
                      805,
                      400,
                      150
                    )
                  );
                }
              }

              if (layout === 'two_memories') {
                const first = requestedContributions[0];
                const second = requestedContributions[1];

                if (first.photoUrl) {
                  objects.push(
                    await makeImageObject(
                      first.photoUrl,
                      60,
                      820,
                      300,
                      140
                    )
                  );
                }

                if (second.photoUrl) {
                  objects.push(
                    await makeImageObject(
                      second.photoUrl,
                      390,
                      820,
                      300,
                      140
                    )
                  );
                }
              }

              const canvasData = {
                objects,
                version: '7.4.0',
                background: '#FFFFFF',
              };

              const previewCanvas = new fabric.StaticCanvas(
                document.createElement('canvas'),
                {
                  width: 750,
                  height: 1000,
                  backgroundColor: '#FFFFFF',
                }
              );

              await previewCanvas.loadFromJSON(canvasData);
              previewCanvas.renderAll();

              const previewDataUrl = previewCanvas.toDataURL({
                format: 'jpeg',
                quality: 0.8,
                multiplier: 1,
              });

              previewCanvas.dispose();

              const saveResponse = await fetch(
                `${API_BASE}/api/pages/${encodeURIComponent(
                  targetPageId
                )}`,
                {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    canvasData,
                    previewDataUrl,
                    expectedVersion,
                  }),
                }
              );

              const saveData = await saveResponse.json();

              if (saveResponse.status === 409) {
                throw new Error(
                  `PAGE_CONFLICT_LATEST_VERSION_${
                    saveData.latestRemoteVersion
                  }`
                );
              }

              if (!saveResponse.ok) {
                throw new Error(
                  `THEMATIC_SPREAD_SAVE_FAILED_${saveResponse.status}`
                );
              }

              return {
                application: 'MemoryBook',
                success: true,
                bookId,
                targetPageId,
                newVersion: saveData.newVersion,
                theme,
                title,
                layout,
                contributionIds:
                  requestedContributions.map(
                    (item: any) => item.id
                  ),
                contributorNames:
                  requestedContributions.map(
                    (item: any) => item.contributorName
                  ),
                sourceContributionsPreserved: true,
                message:
                  'Approved thematic spread built and saved through the versioned MemoryBook page save API.',
              };
            },
          },
          {
            signal: controller.signal,
          }
        );
          await modelContext.registerTool(
            {
              name: 'reorder_pages',
              title: 'Reorder MemoryBook Pages',
              description:
                'Changes the order of all MemoryBook pages. Requires explicit human approval before writing.',
              inputSchema: {
                type: 'object',
                properties: {
                  pageIds: {
                    type: 'array',
                    items: {
                      type: 'string',
                    },
                    minItems: 1,
                    description:
                      'All page IDs in the exact desired order. Every existing page must appear exactly once.',
                  },
                  approved: {
                    type: 'boolean',
                    description:
                      'Must be true only after explicit human approval.',
                  },
                },
                required: ['pageIds', 'approved'],
                additionalProperties: false,
              },
              annotations: {
                readOnlyHint: false,
              },
              execute: async (input: any) => {
                if (input?.approved !== true) {
                  throw new Error('HUMAN_APPROVAL_REQUIRED');
                }

                const requestedPageIds = Array.isArray(input.pageIds)
                  ? input.pageIds.map((id: any) => String(id).trim())
                  : [];

                if (
                  requestedPageIds.length === 0 ||
                  requestedPageIds.some((id: string) => !id)
                ) {
                  throw new Error('INVALID_PAGE_ORDER');
                }

                if (
                  new Set(requestedPageIds).size !== requestedPageIds.length
                ) {
                  throw new Error('DUPLICATE_PAGE_ID');
                }

                const activePageId = currentPageIdRef.current;

                const response = await fetch(
                  `${API_BASE}/api/books/${encodeURIComponent(DEMO_BOOK_ID)}/pages/reorder`,
                  {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      pageIds: requestedPageIds,
                    }),
                  }
                );

                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                  throw new Error(
                    data.error ||
                      `PAGE_REORDER_FAILED_${response.status}`
                  );
                }

                const orderedPageIds = Array.isArray(data.pages)
                  ? data.pages.map((item: any) => String(item.id))
                  : requestedPageIds;

                pageIdsRef.current = orderedPageIds;
                setPageIds(orderedPageIds);

                const activePageNewIndex =
                  orderedPageIds.indexOf(activePageId);

                if (activePageNewIndex >= 0) {
                  setCurrentIndex(activePageNewIndex);
                } else {
                  setCurrentIndex(0);
                }

                return {
                  application: 'MemoryBook',
                  success: true,
                  pageOrder: orderedPageIds,
                  pages: data.pages,
                  message:
                    'Approved MemoryBook page reorder completed successfully.',
                };
              },
            },
            {
              signal: controller.signal,
            }
          );

        setWebMcpStatus('available');
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          return;
        }

        console.error('WebMCP registration failed:', error);
        setWebMcpStatus('error');
      }
    };

    registerWebMcpTool();

    return () => {
      controller.abort();
    };
  }, []);

  const runWebMcpToolTest = async () => {
    setWebMcpTestResult('Teszt folyamatban...');

    try {
      const modelContext = (document as any).modelContext;

      if (!modelContext) {
        setWebMcpTestResult(
          'HIBA: document.modelContext nem érhető el.'
        );
        return;
      }

      if (typeof modelContext.getTools !== 'function') {
        setWebMcpTestResult('HIBA: getTools() nem érhető el.');
        return;
      }

      if (typeof modelContext.executeTool !== 'function') {
        setWebMcpTestResult('HIBA: executeTool() nem érhető el.');
        return;
      }

      setWebMcpTestResult('1/2: Tool lista lekérése...');
      const tools = await modelContext.getTools();
      setWebMcpTestResult('2/2: Tool futtatása...');

      const memoryBookTool = tools.find(
        (tool: any) => tool.name === 'get_memorybook_status'
      );

    if (!memoryBookTool) {
        const toolNames = tools
          .map((tool: any) => tool.name)
          .join(', ');

        setWebMcpTestResult(
          `HIBA: get_memorybook_status nem található. Regisztrált toolok: ${
            toolNames || 'nincsenek'
          }`
        );
        return;
      }

      const result = await modelContext.executeTool(
  memoryBookTool,
  JSON.stringify({ test: 'memorybook' })
);

      setWebMcpTestResult(`SIKER: ${result}`);
    } catch (error: any) {
      console.error('WebMCP tool test failed:', error);

      setWebMcpTestResult(
        `HIBA: ${error?.message ?? String(error)}`
      );
    }
  };

  const loadPage = useCallback(async (pageId: string) => {
    try {
      setLoading(true);
      setLoadError(null);
      setConflictVersion(null);

      const response = await fetch(`${API_BASE}/api/pages/${pageId}`);

      if (!response.ok) {
        throw new Error(`PAGE_LOAD_FAILED_${response.status}`);
      }

      const data = await response.json();

      setPage({
        id: data.id,
        pageNumber: data.pageNumber,
        canvasData: data.canvasData ?? {},
        previewImageUrl: data.previewImageUrl ?? undefined,
        version: data.version,
      });
    } catch (err) {
      console.error(err);
      setLoadError('Nem sikerült betölteni az oldalt.');
      setPage(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPage(currentPageId);
  }, [currentPageId, loadPage]);

  const handleSavePage = async (
    pageId: string,
    canvasJson: Record<string, any>,
    previewDataUrl: string,
    expectedVersion: number
  ): Promise<{ newVersion: number }> => {
    const response = await fetch(`${API_BASE}/api/pages/${pageId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        canvasData: canvasJson,
        previewDataUrl,
        expectedVersion,
      }),
    });

    if (response.status === 409) {
      const errorData = await response.json();
      const conflictError: any = new Error('PAGE_CONFLICT');
      conflictError.status = 409;
      conflictError.latestRemoteVersion =
        errorData.latestRemoteVersion;

      if (pageId === currentPageId) {
        setConflictVersion(errorData.latestRemoteVersion);
      }

      throw conflictError;
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const saveError: any = new Error(
        errorData.error || 'PAGE_SAVE_FAILED'
      );
      saveError.status = response.status;
      throw saveError;
    }

    const data = await response.json();

    if (pageId === currentPageId) {
      setPage((current) =>
        current
          ? {
              ...current,
              version: data.newVersion,
              previewImageUrl:
                data.previewImageUrl ?? current.previewImageUrl,
            }
          : current
      );
    }

    return {
      newVersion: data.newVersion,
    };
  };

  const changePage = async (direction: -1 | 1) => {
    const nextIndex = currentIndex + direction;

    if (nextIndex < 0 || nextIndex >= pageIds.length) {
      return;
    }

    try {
      await editorRef.current?.flush();
      setCurrentIndex(nextIndex);
    } catch (err: any) {
      if (err?.message === 'PAGE_CONFLICT') {
        alert(
          'Előbb oldd fel az ütközést, utána lehet lapozni.'
        );
      } else {
        alert(
          'A mentés nem sikerült. Az oldalváltást leállítottuk.'
        );
      }
    }
  };

  const webMcpLabel =
    webMcpStatus === 'checking'
      ? 'WebMCP: ellenőrzés...'
      : webMcpStatus === 'available'
        ? 'WebMCP: ELÉRHETŐ'
        : webMcpStatus === 'unavailable'
          ? 'WebMCP: nem érhető el ebben a böngészőben'
          : 'WebMCP: regisztrációs hiba';

  const webMcpPanel = (
    <div
      style={{
        padding: '8px 12px',
        textAlign: 'center',
        fontFamily: 'Arial, sans-serif',
        fontSize: 13,
        background:
          webMcpStatus === 'available'
            ? '#dcfce7'
            : '#f1f5f9',
        borderBottom: '1px solid #cbd5e1',
      }}
    >
      <strong>{webMcpLabel}</strong>

      {webMcpStatus === 'available' && (
        <button
          onClick={runWebMcpToolTest}
          style={{ marginLeft: 12 }}
        >
          WebMCP tool teszt
        </button>
      )}

      {webMcpTestResult && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: 'white',
            border: '1px solid #cbd5e1',
            borderRadius: 4,
            wordBreak: 'break-word',
          }}
        >
          {webMcpTestResult}
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <>
        {webMcpPanel}
        <div style={{ padding: 24 }}>Oldal betöltése...</div>
      </>
    );
  }

  if (loadError || !page) {
    return (
      <>
        {webMcpPanel}
        <div
          style={{
            padding: 24,
            fontFamily: 'Arial, sans-serif',
            textAlign: 'center',
          }}
        >
          <strong>{loadError ?? 'Az oldal nem található.'}</strong>
          <div style={{ marginTop: 8, fontSize: 13, color: '#475569' }}>
            A szerkesztő backendje ezen a címen nem érhető el, de a WebMCP teszt továbbra is használható.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: '#0f172a',
          color: 'white',
          padding: '10px 14px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 12,
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <button
          onClick={() => changePage(-1)}
          disabled={currentIndex === 0}
        >
          ← Előző oldal
        </button>

        <strong>{page.pageNumber}. oldal</strong>

        <button
          onClick={() => changePage(1)}
          disabled={currentIndex === pageIds.length - 1}
        >
          Következő oldal →
        </button>
      </div>

      {webMcpPanel}

      {conflictVersion !== null && (
        <div
          style={{
            position: 'sticky',
            top: 44,
            zIndex: 19,
            background: '#fff7ed',
            borderBottom: '1px solid #fdba74',
            padding: 12,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          <strong>
            Ütközés: az oldalt közben másik ablakból
            módosították.
          </strong>

          <button
            onClick={() => {
              editorRef.current?.resolveConflictKeepLocal(
                conflictVersion
              );
              setConflictVersion(null);
            }}
          >
            Saját verzió megtartása
          </button>

          <button onClick={() => window.location.reload()}>
            Szerververzió betöltése
          </button>
        </div>
      )}

      <MemoryBookEditor
        ref={editorRef}
        page={page}
        onSavePage={handleSavePage}
        onConflict={() => {}}
        enableBackgroundControls
      />
    </>
  );
}

export default App;












