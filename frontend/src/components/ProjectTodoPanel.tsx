import { useMemo } from 'react';
import { FolderKanban, CheckSquare, Square, CircleDot, Circle, CheckCircle2 } from 'lucide-react';
import type { ProjectStatus, TodoStatus } from '../types';

interface ProjectTodoPanelProps {
  projects: ProjectStatus[];
  todos: TodoStatus[];
}

const phaseIcon = {
  pending: <Circle size={14} className="text-dark-600 shrink-0" />,
  'in-progress': <CircleDot size={14} className="text-lumi-400 shrink-0" />,
  completed: <CheckCircle2 size={14} className="text-green-400 shrink-0" />,
};

function TodoItem({ todo }: { todo: TodoStatus }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {todo.completed ? (
        <CheckSquare size={14} className="text-green-400 shrink-0" />
      ) : (
        <Square size={14} className="text-dark-500 shrink-0" />
      )}
      <span className={todo.completed ? 'text-dark-500 line-through' : 'text-dark-200'}>
        {todo.name}
      </span>
    </li>
  );
}

function ProjectTodoPanel({ projects, todos }: ProjectTodoPanelProps) {
  const groupedTodos = useMemo(() => {
    const groups: Record<string, TodoStatus[]> = {};
    for (const todo of todos) {
      const key = todo.project || 'Unattached';
      if (!groups[key]) groups[key] = [];
      groups[key].push(todo);
    }
    return groups;
  }, [todos]);

  const groupNames = useMemo(() => {
    const names = Object.keys(groupedTodos);
    // Sort: project-attached groups first (alphabetical), "Unattached" last
    return names.sort((a, b) => {
      if (a === 'Unattached') return 1;
      if (b === 'Unattached') return -1;
      return a.localeCompare(b);
    });
  }, [groupedTodos]);

  if (projects.length === 0 && todos.length === 0) return null;

  return (
    <div className="space-y-4 mt-6">
      {projects.length > 0 && (
        <div className="bg-dark-900 border border-dark-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-dark-800">
            <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wide flex items-center gap-2">
              <FolderKanban size={14} />
              Projects
            </h2>
          </div>
          <div className="p-4 space-y-4">
            {projects.map((project) => (
              <div key={project.name}>
                <h3 className="text-sm font-medium text-dark-200 mb-2">{project.name}</h3>
                <ul className="space-y-1.5 pl-1">
                  {project.phases.map((phase) => (
                    <li key={phase.name} className="flex items-center gap-2 text-sm">
                      {phaseIcon[phase.status]}
                      <span
                        className={
                          phase.status === 'completed'
                            ? 'text-dark-500 line-through'
                            : phase.status === 'in-progress'
                              ? 'text-dark-200'
                              : 'text-dark-400'
                        }
                      >
                        {phase.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {todos.length > 0 && (
        <div className="bg-dark-900 border border-dark-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-dark-800">
            <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wide flex items-center gap-2">
              <CheckSquare size={14} />
              Todos
            </h2>
          </div>
          <div className="p-4 space-y-4">
            {groupNames.map((groupName) => (
              <div key={groupName}>
                <h3 className="text-xs font-semibold text-dark-400 uppercase tracking-wide mb-2">
                  {groupName}
                </h3>
                <ul className="space-y-1.5 pl-1">
                  {groupedTodos[groupName].map((todo) => (
                    <TodoItem key={todo.name} todo={todo} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectTodoPanel;
