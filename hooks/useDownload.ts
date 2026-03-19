import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { useDownloadStore } from '../store/downloadStore';
import { getPlayUrlForDownload } from '../services/bilibili';

const lastReportedProgress: Record<string, number> = {};

const QUALITY_LABELS: Record<number, string> = {
  16: '360P', 32: '480P', 64: '720P',
  80: '1080P', 112: '1080P+', 116: '1080P60',
};

/** 等待 App 回到前台 */
function waitForActive(): Promise<void> {
  return new Promise((resolve) => {
    if (AppState.currentState === 'active') { resolve(); return; }
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { sub.remove(); resolve(); }
    });
  });
}

/** 当前是否在后台 */
function isBackground() {
  return AppState.currentState !== 'active';
}

/** 读取本地文件实际大小 */
async function readFileSize(uri: string): Promise<number | undefined> {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    if (info.exists) return (info as any).size as number;
  } catch {}
  return undefined;
}

export function useDownload() {
  const { tasks, addTask, updateTask, removeTask } = useDownloadStore();

  function taskKey(bvid: string, qn: number) { return `${bvid}_${qn}`; }
  function localPath(bvid: string, qn: number) {
    return `${FileSystem.documentDirectory}${bvid}_${qn}.mp4`;
  }

  async function startDownload(
    bvid: string, cid: number, qn: number,
    qdesc: string, title: string, cover: string,
  ) {
    const key = taskKey(bvid, qn);
    if (tasks[key]?.status === 'downloading') return;

    addTask(key, {
      bvid, title, cover, qn,
      qdesc: qdesc || QUALITY_LABELS[qn] || String(qn),
      status: 'downloading', progress: 0, createdAt: Date.now(),
    });

    // 最多重新拉取 URL 并重试一次（应对后台时 URL 过期的情况）
    for (let attempt = 0; attempt < 2; attempt++) {
      const success = await attemptDownload(key, bvid, cid, qn);
      if (success !== 'retry') return;
      // 需要重试：重新拉取 URL
      updateTask(key, { status: 'downloading', progress: 0 });
      lastReportedProgress[key] = -1;
    }

    updateTask(key, { status: 'error', error: '下载失败，请重试' });
  }

  /** 执行一次下载尝试。返回 'done' | 'error' | 'retry' */
  async function attemptDownload(
    key: string, bvid: string, cid: number, qn: number,
  ): Promise<'done' | 'error' | 'retry'> {
    try {
      const [url, buvid3, sessdata] = await Promise.all([
        getPlayUrlForDownload(bvid, cid, qn),
        AsyncStorage.getItem('buvid3'),
        AsyncStorage.getItem('SESSDATA'),
      ]);
      const dest = localPath(bvid, qn);

      const cookies: string[] = [];
      if (buvid3) cookies.push(`buvid3=${buvid3}`);
      if (sessdata) cookies.push(`SESSDATA=${sessdata}`);

      const headers = {
        Referer: 'https://www.bilibili.com',
        Origin: 'https://www.bilibili.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(cookies.length > 0 && { Cookie: cookies.join('; ') }),
      };

      const progressCallback = (p: FileSystem.DownloadProgressData) => {
        const { totalBytesWritten, totalBytesExpectedToWrite } = p;
        const progress = totalBytesExpectedToWrite > 0
          ? totalBytesWritten / totalBytesExpectedToWrite : 0;
        const last = lastReportedProgress[key] ?? -1;
        if (progress - last >= 0.01) {
          lastReportedProgress[key] = progress;
          updateTask(key, { progress });
        }
      };

      const resumable = FileSystem.createDownloadResumable(url, dest, { headers }, progressCallback);

      // 进入后台时主动暂停，抢在 OS 断连之前
      let bgPaused = false;
      const appStateSub = AppState.addEventListener('change', async (state) => {
        if ((state === 'background' || state === 'inactive') && !bgPaused) {
          bgPaused = true;
          try { await resumable.pauseAsync(); } catch {}
        }
      });

      let result: FileSystem.DownloadResult | null = null;

      try {
        result = await resumable.downloadAsync();
      } catch (e: any) {
        // downloadAsync 抛出：多为后台断连（connection abort）或被 pauseAsync 中断
        if (!isBackground() && !bgPaused) {
          // 真实网络错误，非后台原因
          appStateSub.remove();
          delete lastReportedProgress[key];
          const msg = e?.message ?? '下载失败';
          updateTask(key, { status: 'error', error: msg.length > 40 ? msg.slice(0, 40) + '...' : msg });
          return 'error';
        }
        // 后台引发的中断，走下面的续传逻辑
        result = null;
      } finally {
        appStateSub.remove();
      }

      // ── 续传逻辑：result 为 null 说明被暂停或中断 ──
      if (!result?.uri) {
        // 等 App 回到前台
        if (isBackground()) await waitForActive();

        // 尝试从断点续传
        try {
          result = await resumable.resumeAsync();
        } catch {
          result = null;
        }

        // 续传仍失败（URL 可能过期），通知上层重试
        if (!result?.uri) {
          delete lastReportedProgress[key];
          return 'retry';
        }
      }

      // ── 下载完成 ──
      delete lastReportedProgress[key];
      const fileSize = await readFileSize(result.uri);
      updateTask(key, {
        status: 'done', progress: 1, localUri: result.uri,
        ...(fileSize ? { fileSize } : {}),
      });
      return 'done';

    } catch (e: any) {
      delete lastReportedProgress[key];
      console.error('[Download] failed:', e);
      const msg = e?.message ?? '下载失败';
      updateTask(key, { status: 'error', error: msg.length > 40 ? msg.slice(0, 40) + '...' : msg });
      return 'error';
    }
  }

  function getLocalUri(bvid: string, qn: number): string | undefined {
    return tasks[taskKey(bvid, qn)]?.localUri;
  }

  function cancelDownload(bvid: string, qn: number) {
    removeTask(taskKey(bvid, qn));
  }

  return { tasks, startDownload, getLocalUri, cancelDownload, taskKey };
}
