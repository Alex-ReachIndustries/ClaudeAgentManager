import { useState, useEffect, useCallback } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, X, Loader2, ArrowLeft } from 'lucide-react';
import { fetchFolders, fetchWtWindows, fetchRoles, type FolderEntry, type Role } from '../api';

interface NewAgentOptions {
  wtWindow?: string;
  role?: string;
  task?: string;
  effort: string;
  model: string;
}

interface FolderPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string, options: NewAgentOptions) => void;
}

interface TreeNode {
  entry: FolderEntry;
  children: TreeNode[] | null;
  expanded: boolean;
}

const EFFORT_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
];

function FolderPicker({ isOpen, onClose, onSelect }: FolderPickerProps) {
  // Step 1 state
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Step nav
  const [step, setStep] = useState<1 | 2>(1);

  // Step 2 state
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('__custom__');
  const [customRole, setCustomRole] = useState('');
  const [task, setTask] = useState('');
  const [effort, setEffort] = useState('high');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [wtWindows, setWtWindows] = useState<string[]>([]);
  const [selectedWindow, setSelectedWindow] = useState('');
  const [customWindow, setCustomWindow] = useState('');

  const loadFolder = useCallback(async (folderPath: string) => {
    const result = await fetchFolders(folderPath);
    return result.folders.map((f): TreeNode => ({ entry: f, children: null, expanded: false }));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setSelectedPath('');
    setStep(1);
    setTask('');
    setCustomRole('');
    setSelectedRoleId('__custom__');
    setEffort('high');
    setModel('claude-sonnet-4-6');
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
          if (node.expanded) return { ...node, expanded: false };
          if (node.children === null) {
            setLoadingPath(path);
            try {
              const children = await loadFolder(path);
              return { ...node, children, expanded: true };
            } finally { setLoadingPath(null); }
          }
          return { ...node, expanded: true };
        }
        if (node.children && node.expanded) {
          let updatedChildren = node.children;
          await toggleNode(path, node.children, (c) => { updatedChildren = c; });
          return { ...node, children: updatedChildren };
        }
        return node;
      }),
    );
    setNodes(updated);
  };

  const handleToggle = async (path: string) => { await toggleNode(path, roots, setRoots); };

  const goToStep2 = () => {
    setStep(2);
    fetchRoles().then(setRoles).catch(() => {});
  };

  const handleLaunch = () => {
    const finalRole = selectedRoleId === '__custom__'
      ? (customRole.trim() || undefined)
      : roles.find(r => r.id === selectedRoleId)?.fullDefinition;
    const effectiveWindow = customWindow.trim() || selectedWindow || undefined;
    onSelect(selectedPath, {
      wtWindow: effectiveWindow,
      role: finalRole,
      task: task.trim() || undefined,
      effort,
      model,
    });
  };

  const renderTree = (nodes: TreeNode[], depth = 0): React.ReactNode =>
    nodes.map((node) => {
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
              onClick={(e) => { e.stopPropagation(); if (node.entry.hasChildren) handleToggle(node.entry.path); }}
            >
              {isLoading ? <Loader2 size={12} className="animate-spin text-dark-500" />
                : node.entry.hasChildren
                  ? node.expanded ? <ChevronDown size={12} className="text-dark-500" /> : <ChevronRight size={12} className="text-dark-500" />
                  : <span className="w-3" />}
            </button>
            {node.expanded
              ? <FolderOpen size={14} className="text-lumi-400 flex-shrink-0" />
              : <Folder size={14} className="text-dark-500 flex-shrink-0" />}
            <span className="truncate">{node.entry.name}</span>
          </div>
          {node.expanded && node.children && node.children.length > 0 && (
            <div>{renderTree(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-900 border border-dark-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-800">
          <div className="flex items-center gap-3">
            {step === 2 && (
              <button onClick={() => setStep(1)} className="p-1 text-dark-500 hover:text-dark-300 rounded transition-colors">
                <ArrowLeft size={16} />
              </button>
            )}
            <h2 className="text-lg font-semibold text-dark-100">
              {step === 1 ? 'New Agent' : 'Configure Agent'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 text-dark-500 hover:text-dark-300 rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex border-b border-dark-800">
          {[{ n: 1, label: 'Folder' }, { n: 2, label: 'Configure' }].map(({ n, label }) => (
            <div
              key={n}
              className={`flex-1 py-2 text-center text-xs font-medium border-b-2 transition-colors ${
                step === n
                  ? 'text-lumi-300 border-lumi-500'
                  : step > n
                    ? 'text-dark-400 border-dark-600'
                    : 'text-dark-600 border-transparent'
              }`}
            >
              <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-xs mr-1.5 ${step === n ? 'bg-lumi-600 text-white' : step > n ? 'bg-dark-600 text-dark-300' : 'bg-dark-800 text-dark-600'}`}>{n}</span>
              {label}
            </div>
          ))}
        </div>

        {/* ── Step 1: Folder picker ── */}
        {step === 1 && (
          <>
            <div className="px-5 py-2 bg-dark-850 border-b border-dark-800">
              <span className="text-xs text-dark-500">Path: </span>
              <span className="text-xs text-dark-300 font-mono">
                {selectedPath ? `~/${selectedPath}` : '~ (home)'}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3 min-h-[200px]">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-dark-500" />
                </div>
              ) : error ? (
                <p className="text-red-400 text-sm text-center py-12">{error}</p>
              ) : roots.length === 0 ? (
                <p className="text-dark-500 text-sm text-center py-12">No folders found</p>
              ) : renderTree(roots)}
            </div>
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-dark-800">
              <button onClick={onClose} className="px-4 py-2 text-sm text-dark-400 hover:text-dark-200 transition-colors">
                Cancel
              </button>
              <button
                onClick={goToStep2}
                disabled={!selectedPath}
                className="px-4 py-2 text-sm bg-lumi-600 hover:bg-lumi-500 disabled:bg-dark-700 disabled:text-dark-500 text-white rounded-lg transition-colors"
              >
                Next →
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Configuration ── */}
        {step === 2 && (
          <>
            <div className="px-5 py-2 bg-dark-850 border-b border-dark-800">
              <span className="text-xs text-dark-500">Folder: </span>
              <span className="text-xs text-dark-300 font-mono">
                ~/{selectedPath.split('/').pop() || selectedPath}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Role */}
              <div>
                <label className="text-xs font-medium text-dark-400 mb-1.5 block">Role <span className="text-dark-600 font-normal">(optional)</span></label>
                <select
                  value={selectedRoleId}
                  onChange={e => setSelectedRoleId(e.target.value)}
                  className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-dark-200 focus:outline-none focus:border-lumi-600/50 mb-2"
                >
                  <option value="__custom__">Custom</option>
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.displayName}</option>
                  ))}
                </select>
                {selectedRoleId === '__custom__' && (
                  <input
                    type="text"
                    value={customRole}
                    onChange={e => setCustomRole(e.target.value)}
                    placeholder="e.g. Designer, PM, Code Reviewer…"
                    className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-dark-200 placeholder-dark-600 focus:outline-none focus:border-lumi-600/50"
                  />
                )}
              </div>

              {/* Task */}
              <div>
                <label className="text-xs font-medium text-dark-400 mb-1.5 block">Task <span className="text-dark-600 font-normal">(optional)</span></label>
                <textarea
                  value={task}
                  onChange={e => setTask(e.target.value)}
                  placeholder="Describe what this agent should do…"
                  rows={3}
                  className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-dark-200 placeholder-dark-600 resize-none focus:outline-none focus:border-lumi-600/50"
                />
              </div>

              {/* Effort + Model */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-dark-400 mb-1.5 block">Effort</label>
                  <select
                    value={effort}
                    onChange={e => setEffort(e.target.value)}
                    className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-dark-200 focus:outline-none focus:border-lumi-600/50"
                  >
                    {EFFORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-dark-400 mb-1.5 block">Model</label>
                  <select
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-dark-200 focus:outline-none focus:border-lumi-600/50"
                  >
                    {MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Window Group */}
              <div>
                <label className="text-xs font-medium text-dark-400 mb-1.5 block">Terminal window <span className="text-dark-600 font-normal">(optional)</span></label>
                {wtWindows.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {wtWindows.map(w => (
                      <button
                        key={w}
                        onClick={() => { setSelectedWindow(selectedWindow === w ? '' : w); setCustomWindow(''); }}
                        className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                          selectedWindow === w && !customWindow
                            ? 'bg-lumi-600/30 text-lumi-300 border border-lumi-500/50'
                            : 'bg-dark-800 text-dark-400 border border-dark-700 hover:border-dark-600 hover:text-dark-300'
                        }`}
                      >{w}</button>
                    ))}
                  </div>
                )}
                <input
                  type="text"
                  value={customWindow}
                  onChange={e => { setCustomWindow(e.target.value); if (e.target.value) setSelectedWindow(''); }}
                  placeholder={wtWindows.length > 0 ? 'or type a new group name…' : 'group name (e.g. assistants)'}
                  className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-1.5 text-xs text-dark-200 placeholder-dark-600 focus:outline-none focus:border-dark-600"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-dark-800">
              <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-dark-400 hover:text-dark-200 transition-colors">
                Back
              </button>
              <button
                onClick={handleLaunch}
                className="px-4 py-2 text-sm bg-lumi-600 hover:bg-lumi-500 text-white rounded-lg transition-colors"
              >
                Launch Agent
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default FolderPicker;
