import React, { useState, useRef, useEffect } from 'react';
import {
  View, StyleSheet, Dimensions, TouchableOpacity,
  Text, Modal,
} from 'react-native';
import Video, { VideoRef } from 'react-native-video';
import { Ionicons } from '@expo/vector-icons';
import type { PlayUrlResponse } from '../services/types';
import { buildDashMpdUri } from '../utils/dash';

const { width } = Dimensions.get('window');
const VIDEO_HEIGHT = width * 0.5625;

const BILIBILI_HEADERS = {
  Referer: 'https://www.bilibili.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

interface Props {
  playData: PlayUrlResponse | null;
  qualities: { qn: number; desc: string }[];
  currentQn: number;
  onQualityChange: (qn: number) => void;
  onFullscreen: () => void;
  onMiniPlayer?: () => void;
  style?: object;
  onProgress?: (currentTime: number, duration: number) => void;
  seekTo?: { t: number; v: number };
}

export function NativeVideoPlayer({
  playData, qualities, currentQn, onQualityChange, onFullscreen, onMiniPlayer, style,
  onProgress, seekTo,
}: Props) {
  const [showQuality, setShowQuality] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>();
  const videoRef = useRef<VideoRef>(null);
  const currentDesc = qualities.find(q => q.qn === currentQn)?.desc ?? (currentQn ? String(currentQn) : 'HD');
  const isDash = !!playData?.dash;

  useEffect(() => {
    if (!playData) { setResolvedUrl(undefined); return; }
    if (isDash) {
      buildDashMpdUri(playData, currentQn).then(setResolvedUrl).catch(() => {
        setResolvedUrl(playData.dash!.video[0]?.baseUrl);
      });
    } else {
      setResolvedUrl(playData.durl?.[0]?.url);
    }
  }, [playData, currentQn]);

  useEffect(() => {
    if (seekTo !== undefined) videoRef.current?.seek(seekTo.t);
  }, [seekTo]);

  return (
    <View style={[styles.container, style]}>
      {resolvedUrl ? (
        <Video
          key={resolvedUrl}
          ref={videoRef}
          source={isDash
            ? { uri: resolvedUrl, type: 'mpd', headers: BILIBILI_HEADERS }
            : { uri: resolvedUrl, headers: BILIBILI_HEADERS }
          }
          style={styles.video}
          resizeMode="contain"
          controls
          paused={false}
          onProgress={({ currentTime, seekableDuration }) =>
            onProgress?.(currentTime, seekableDuration)
          }
        />
      ) : (
        <View style={styles.placeholder} />
      )}

      <View style={styles.controls}>
        <TouchableOpacity style={styles.ctrlBtn} onPress={() => setShowQuality(true)}>
          <Text style={styles.qualityText}>{currentDesc}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={onFullscreen}>
          <Ionicons name="expand" size={18} color="#fff" />
        </TouchableOpacity>
        {onMiniPlayer && (
          <TouchableOpacity style={styles.ctrlBtn} onPress={onMiniPlayer}>
            <Ionicons name="tablet-portrait-outline" size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={showQuality} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setShowQuality(false)}>
          <View style={styles.qualityList}>
            <Text style={styles.qualityTitle}>选择清晰度</Text>
            {qualities.map(q => (
              <TouchableOpacity
                key={q.qn}
                style={styles.qualityItem}
                onPress={() => { setShowQuality(false); onQualityChange(q.qn); }}
              >
                <Text style={[styles.qualityItemText, q.qn === currentQn && styles.qualityItemActive]}>
                  {q.desc}
                </Text>
                {q.qn === currentQn && <Ionicons name="checkmark" size={16} color="#00AEEC" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width, height: VIDEO_HEIGHT, backgroundColor: '#000' },
  video: { flex: 1 },
  placeholder: { flex: 1, backgroundColor: '#000' },
  controls: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', gap: 8 },
  ctrlBtn: { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center', justifyContent: 'center' },
  qualityText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  qualityList: { backgroundColor: '#fff', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 16, minWidth: 180 },
  qualityTitle: { fontSize: 15, fontWeight: '700', color: '#212121', paddingVertical: 10, textAlign: 'center' },
  qualityItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee' },
  qualityItemText: { fontSize: 14, color: '#333' },
  qualityItemActive: { color: '#00AEEC', fontWeight: '700' },
});
