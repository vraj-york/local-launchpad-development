import React, { useEffect } from 'react';

const Modal = ({ isOpen, onClose, children, allowOverlayClose }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key !== 'Escape' || !isOpen) return;
      const mayClose = typeof allowOverlayClose !== 'function' || allowOverlayClose();
      if (mayClose) onClose();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, allowOverlayClose]);

  const handleOverlayClick = () => {
    const mayClose = typeof allowOverlayClose !== 'function' || allowOverlayClose();
    if (mayClose) onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="feedback-widget-overlay" onClick={handleOverlayClick}>
      <div className="feedback-widget-modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
};

export default Modal;
