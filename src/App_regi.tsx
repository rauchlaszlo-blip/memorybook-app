import { useState } from 'react';
import { MemoryBookEditor, type PageData } from './MemoryBookEditor';

function App() {
  const [page] = useState<PageData>({
    id: 'test-page-1',
    pageNumber: 1,
    version: 1,
    canvasData: {},
  });

  const handleSavePage = async (
    pageId: string,
    canvasJson: Record<string, any>,
    previewDataUrl: string,
    expectedVersion: number
  ): Promise<{ newVersion: number }> => {
    console.log('MENTÉS TESZT', {
      pageId,
      canvasJson,
      previewDataUrl,
      expectedVersion,
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      newVersion: expectedVersion + 1,
    };
  };

  return (
    <MemoryBookEditor
      page={page}
      onSavePage={handleSavePage}
      onConflict={(pageId) => {
        console.log('ÜTKÖZÉS:', pageId);
      }}
    />
  );
}

export default App;