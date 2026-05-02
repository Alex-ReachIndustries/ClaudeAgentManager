import { useState, useEffect, useCallback } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, X, Loader2 } from 'lucide-react';
import { fetchFolders, fetchWtWindows, type FolderEntry } from '../api';

interface FolderPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string, wtWindow?: string) => void;
}

interface TreeNode {
  entry: FolderEntry;
  children: TreeNode[] | null; // null = not loaded
  expanded: boolean;
}

function FolderPicker({ isOpen, onClose, onSelect }: FolderPickerProps) {
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wtWindows, setWtWindows] = useState<string[]>([]);
  const [selectedWindow, setSelectedWindow] = useState<string>('');
  const [customWindow, setCustomWindow] = useState<string>('');

  const loadFolder = useCallback(async (folderPath: string) => {
    const result = await fetchFolders(folderPath);
    return result.folders.map((f): TreeNode => ({
      entry: f,
      children: null,
      expanded: false,
    }));
  }, []);

  // Load root folders and existing window groups on open
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setSelectedPath('');
    setSelectedWindow('');
    setCustomWindow('');
    Promise.all([
      loadFolder(''),
      fetchWtWindows().catch(() => [] as string[]),
    ])
      .then(([folders, windows]) => {
        setRoots(folders);
        setWtWindows(windows);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [isOpen, loadFolder]);

  const toggleNode = async (path: string, nodes: TreeNode[], setNodes: (n: TreeNode[]) => void) => {
    const updated = await Promise.all(
      nodes.map(async (node) => {
        if (node.entry.path === path) {
          if (node.expanded) {
            return { ...node, expanded: false };
          }
          if (node.children === null) {
            setLoadingPath(path);
            try {
              const children = await loadFolder(path);
              return { ...node, children, expanded: true };
            } finally {
              setLoadingPath(null);
            }
          }
          return { ...node, expanded: true };
        }
        if (node.children && node.expanded) {
          let updatedChildren = node.children;
          await toggleNode(path, node.children, (c) => {
            updatedChildren = c;
          });
          return { ...node, children: updatedChildren };
        }
        return node;
      }),
    );
    setNodes(updated);
  };

  const handleToggle = async (path: string) => {
    await toggleNode(path, roots, setRoots);
  };

  const renderTree = (nodes: TreeNode[], depth: number = 0): React.ReactNode => {
    return nodes.map((node) => {
      const isSelected = selectedPath === node.entry.path;
      const isLoading = loadingPath === node.entry.path;

      return (
        <div key={node.entry.path}>
          <div
            className={`flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer transition-colors text-sm ${
              isSelected
                ? 'bg-lumi-600/20 text-lumi-300 border border-lumi-500/30'
                : 'hover:bg-dark-800 text-dark-300 border border-transparent'
            }`}
            style={{ paddingLeft: `${depth * 20 + 8}px` }}
            onClick={() => setSelectedPath(node.entry.path)}
            onDoubleClick={() => node.entry.hasChildren && handleToggle(node.entry.path)}
          >
            <button
              className="w-4 h-4 flex items-center justify-center flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                if (node.entry.hasChildren) handleToggle(node.entry.path);
              }}
            >
              {isLoading ? (
                <Loader2 size={12} className="animate-spin text-dark-500" />
              ) : node.entry.hasChildren ? (
                node.expanded ? (
                  <ChevronDown size={12} className="text-dark-500" />
                ) : (
                  <ChevronRight size={12} className="text-dark-500" />
                )
              ) : (
                <span className="w-3" />
              )}
            </button>

            {node.expanded ? (
              <FolderOpen size={14} className="text-lumi-400 flex-shrink-0" />
            ) : (
              <Folder size={14} className="text-dark-500 flex-shrink-0" />
            )}

            <span className="truncate">{node.entry.name}</span>
          </div>

          {node.expanded && node.children && node.children.length > 0 && (
            <div>{renderTree(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  const effectiveWindow = customWindow.trim() || selectedWindow || undefined;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-900 border border-dark-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-800">
          <h2 className="text-lg font-semibold text-dark-100">New Agent</h2>
          <button
            onClick={onClose}
            className="p-1 text-dark-500 hover:text-dark-300 rounded transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Selected path display */}
        <div className="px-5 py-2 bg-dark-850 border-b border-dark-800">
          <span className="text-xs text-dark-500">Path: </span>
          <span className="text-xs text-dark-300 font-mono">
            {selectedPath ? `~/${selectedPath}` : '~ (home)'}
          </span>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto px-3 py-3 min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-dark-500" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          ) : roots.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-dark-500 text-sm">No folders found</p>
            </div>
          ) : (
            renderTree(roots)
          )}
        </div>

        {/* Terminal window group */}
        <div className="px-5 py-3 border-t border-dark-800 space-y-2">
          <p className="text-xs font-medium text-dark-400">Terminal window <span className="text-dark-600 font-normal">(optional)</span></p>
          {wtWindows.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {wtWindows.map((w) => (
                <button
                  key={w}
                  onClick={() => {
                    if (selectedWindow === w) {
                      setSelectedWindow('');
                    } else {
                      setSelectedWindow(w);
                      setCustomWindow('');
                    }
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                    selectedWindow === w && !customWindow
                      ? 'bg-lumi-600/30 text-lumi-300 border border-lumi-500/50'
                      : 'bg-dark-800 text-dark-400 border border-dark-700 hover:border-dark-600 hover:text-dark-300'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            value={customWindow}
            onChange={(e) => {
              setCustomWindow(e.target.value);
              if (e.target.value) setSelectedWindow('');
            }}
            placeholder={wtWindows.length > 0 ? 'or type a new group name…' : 'group name (e.g. assistants)'}
            className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-1.5 text-xs text-dark-200 placeholder-dark-600 focus:outline-none focus:border-dark-600"
          />
          {effectiveWindow && (
            <p className="text-xs text-dark-500">Will open in window: <span className="text-dark-300 font-mono">{effectiveWindow}</span></p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-dark-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-dark-400 hover:text-dark-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSelect(selectedPath, effectiveWindow)}
            className="px-4 py-2 text-sm bg-lumi-600 hover:bg-lumi-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!selectedPath}
          >
            Launch Agent Here
          </button>
        </div>
      </div>
    </div>
  );
}

export default FolderPicker;
