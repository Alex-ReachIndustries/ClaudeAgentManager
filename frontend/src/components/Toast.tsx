import { useEffect } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error';
  onClose: () => void;
}

function Toast({ message, type, onClose }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`fixed bottom-6 right-6 z-[100] px-4 py-3 rounded-lg border text-sm shadow-lg ${
      type === 'success'
        ? 'bg-green-900/80 border-green-700/60 text-green-200'
        : 'bg-red-900/80 border-red-700/60 text-red-200'
    }`}>
      {message}
    </div>
  );
}

export default Toast;
