import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, ScrollView, Platform, Modal } from 'react-native';
import { useGameStore, SaveSlotMeta } from '../store';
import { Save, FolderOpen, Trash2, X, Clock, Droplets, TreePine, Hammer } from 'lucide-react-native';

interface SaveLoadModalProps {
  visible: boolean;
  mode: 'save' | 'load';
  onClose: () => void;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const month = d.toLocaleString('default', { month: 'short' });
  const day = d.getDate();
  const hours = d.getHours();
  const mins = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${month} ${day}, ${h12}:${mins} ${ampm}`;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function SlotCard({ slot, mode, onLoad, onDelete, onOverwrite }: {
  slot: SaveSlotMeta;
  mode: 'save' | 'load';
  onLoad: () => void;
  onDelete: () => void;
  onOverwrite: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isAutoSave = slot.id === 'autosave';
  const hasScreenshot = !!slot.screenshot;
  const hasThumbnail = !!slot.thumbnail;

  return (
    <View style={styles.slotCard}>
      {/* Preview Images Row */}
      <View style={styles.previewRow}>
        {/* Main screenshot / fallback */}
        <View style={styles.screenshotContainer}>
          {hasScreenshot ? (
            <Image
              source={{ uri: slot.screenshot }}
              style={styles.screenshot}
            />
          ) : hasThumbnail ? (
            <Image
              source={{ uri: slot.thumbnail }}
              style={styles.screenshot}
              {...Platform.select({ web: { style: { ...styles.screenshot, imageRendering: 'pixelated' } as any } })}
            />
          ) : (
            <View style={[styles.screenshot, styles.noThumbnail]}>
              <Text style={styles.noThumbText}>No Preview</Text>
            </View>
          )}
          {/* Auto-save badge */}
          {isAutoSave && (
            <View style={styles.autoSaveBadge}>
              <Clock color="#fbbf24" size={10} />
              <Text style={styles.autoSaveBadgeText}>AUTO</Text>
            </View>
          )}
          {/* Minimap overlay (only if we also have a screenshot) */}
          {hasScreenshot && hasThumbnail && (
            <View style={styles.minimapOverlay}>
              <Image
                source={{ uri: slot.thumbnail }}
                style={styles.minimapThumb}
                {...Platform.select({ web: { style: { ...styles.minimapThumb, imageRendering: 'pixelated' } as any } })}
              />
            </View>
          )}
        </View>

        {/* Info + Actions */}
        <View style={styles.infoActionsColumn}>
          <View style={styles.slotInfo}>
            <Text style={styles.slotDate}>{formatDate(slot.timestamp)}</Text>
            <Text style={styles.slotTimeAgo}>{formatTimeAgo(slot.timestamp)}</Text>

            <View style={styles.slotStatsRow}>
              <View style={styles.miniStat}>
                <Droplets color="#60a5fa" size={12} />
                <Text style={styles.miniStatText}>{slot.stats.waterCoverage}%</Text>
              </View>
              <View style={styles.miniStat}>
                <TreePine color="#22c55e" size={12} />
                <Text style={styles.miniStatText}>{slot.stats.treesDowned}</Text>
              </View>
              <View style={styles.miniStat}>
                <Hammer color="#f59e0b" size={12} />
                <Text style={styles.miniStatText}>{slot.stats.sticksPlaced}</Text>
              </View>
            </View>

            <Text style={styles.slotDay}>Day {slot.stats.dayNumber || 1}</Text>
          </View>

          {/* Actions */}
          <View style={styles.slotActions}>
            {mode === 'load' ? (
              <Pressable style={styles.loadBtn} onPress={onLoad}>
                <FolderOpen color="#fff" size={16} />
                <Text style={styles.actionBtnText}>Load</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.overwriteBtn} onPress={onOverwrite}>
                <Save color="#fff" size={16} />
                <Text style={styles.actionBtnText}>Overwrite</Text>
              </Pressable>
            )}

            {!isAutoSave && (
              confirmDelete ? (
                <View style={styles.confirmDeleteRow}>
                  <Pressable style={styles.confirmDeleteBtn} onPress={() => { onDelete(); setConfirmDelete(false); }}>
                    <Text style={styles.confirmDeleteText}>Delete?</Text>
                  </Pressable>
                  <Pressable style={styles.cancelDeleteBtn} onPress={() => setConfirmDelete(false)}>
                    <Text style={styles.cancelDeleteText}>No</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable style={styles.deleteBtn} onPress={() => setConfirmDelete(true)}>
                  <Trash2 color="#f87171" size={14} />
                </Pressable>
              )
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

export function SaveLoadModal({ visible, mode, onClose }: SaveLoadModalProps) {
  const [slots, setSlots] = useState<SaveSlotMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const getSaveSlots = useGameStore((state) => state.getSaveSlots);
  const saveGame = useGameStore((state) => state.saveGame);
  const loadGame = useGameStore((state) => state.loadGame);
  const deleteSlot = useGameStore((state) => state.deleteSlot);

  const refreshSlots = async () => {
    setLoading(true);
    const s = await getSaveSlots();
    // Sort: autosave first, then by timestamp descending (newest first)
    s.sort((a, b) => {
      if (a.id === 'autosave') return -1;
      if (b.id === 'autosave') return 1;
      return b.timestamp - a.timestamp;
    });
    setSlots(s);
    setLoading(false);
  };

  useEffect(() => {
    if (visible) refreshSlots();
  }, [visible]);

  const handleNewSave = async () => {
    await saveGame();
    await refreshSlots();
  };

  const handleOverwrite = async (slotId: string) => {
    await saveGame(slotId);
    await refreshSlots();
  };

  const handleLoad = async (slotId: string) => {
    await loadGame(slotId);
    onClose();
  };

  const handleDelete = async (slotId: string) => {
    await deleteSlot(slotId);
    await refreshSlots();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {mode === 'save' ? '💾 Save Game' : '📂 Load Game'}
            </Text>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <X color="#fff" size={20} />
            </Pressable>
          </View>

          {/* New Save Button (save mode only) */}
          {mode === 'save' && (
            <Pressable style={styles.newSaveBtn} onPress={handleNewSave}>
              <Save color="#fff" size={20} />
              <Text style={styles.newSaveBtnText}>Save to New Slot</Text>
            </Pressable>
          )}

          {/* Slots List */}
          <ScrollView style={styles.slotsList} contentContainerStyle={styles.slotsContent}>
            {loading ? (
              <Text style={styles.emptyText}>Loading saves...</Text>
            ) : slots.length === 0 ? (
              <Text style={styles.emptyText}>
                {mode === 'load' ? 'No saved games found.' : 'No existing saves. Create a new one!'}
              </Text>
            ) : (
              slots.map(slot => (
                <SlotCard
                  key={slot.id}
                  slot={slot}
                  mode={mode}
                  onLoad={() => handleLoad(slot.id)}
                  onDelete={() => handleDelete(slot.id)}
                  onOverwrite={() => handleOverwrite(slot.id)}
                />
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modal: {
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    width: '100%',
    maxWidth: 560,
    maxHeight: '85%',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(250, 204, 21, 0.3)',
    ...Platform.select({
      web: {
        boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
      } as any,
    }),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  headerTitle: {
    color: '#fef3c7',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  newSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    margin: 16,
    marginBottom: 8,
    backgroundColor: '#16a34a',
    paddingVertical: 14,
    borderRadius: 12,
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
  newSaveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  slotsList: {
    flex: 1,
  },
  slotsContent: {
    padding: 16,
    paddingTop: 8,
    gap: 12,
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 40,
    fontStyle: 'italic',
  },
  slotCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 4,
  },
  previewRow: {
    flexDirection: 'row',
  },
  screenshotContainer: {
    width: 160,
    height: 100,
    position: 'relative',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  screenshot: {
    width: 160,
    height: 100,
    resizeMode: 'cover',
  },
  noThumbnail: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noThumbText: {
    color: '#6b7280',
    fontSize: 9,
    textAlign: 'center',
  },
  minimapOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    borderWidth: 2,
    borderColor: '#78350f',
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  minimapThumb: {
    width: 40,
    height: 40,
    resizeMode: 'cover',
  },
  autoSaveBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.75)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  autoSaveBadgeText: {
    color: '#fbbf24',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  infoActionsColumn: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  slotInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  slotDate: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '700',
  },
  slotTimeAgo: {
    color: '#9ca3af',
    fontSize: 11,
    marginTop: 2,
  },
  slotStatsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  miniStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  miniStatText: {
    color: '#d1d5db',
    fontSize: 11,
    fontWeight: '600',
  },
  slotDay: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  slotActions: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 8,
    gap: 6,
  },
  loadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(56, 189, 248, 0.35)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.5)',
  },
  overwriteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(245, 158, 11, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.5)',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  deleteBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(248, 113, 113, 0.15)',
  },
  confirmDeleteRow: {
    flexDirection: 'row',
    gap: 4,
  },
  confirmDeleteBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  confirmDeleteText: {
    color: '#f87171',
    fontSize: 10,
    fontWeight: '800',
  },
  cancelDeleteBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  cancelDeleteText: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '700',
  },
});

