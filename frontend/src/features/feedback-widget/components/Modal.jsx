import React, { useEffect } from "react";

const Modal = ({ isOpen, onClose, children, allowOverlayClose }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }

    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key !== "Escape" || !isOpen) return;
      const mayClose =
        typeof allowOverlayClose !== "function" || allowOverlayClose();
      if (mayClose) onClose();
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose, allowOverlayClose]);

  const handleOverlayClick = () => {
    const mayClose =
      typeof allowOverlayClose !== "function" || allowOverlayClose();
    if (mayClose) onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      data-feedback-widget-overlay
      className="fixed inset-0 z-[1000000] flex h-full w-full animate-in fade-in-0 duration-200 items-center justify-center bg-black/50"
      onClick={handleOverlayClick}
    >
      <div
        className="flex h-[90vh] max-h-[900px] w-[95vw] max-w-[1800px] flex-col overflow-hidden rounded-xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)] animate-in fade-in-0 slide-in-from-bottom-[50px] duration-300 max-md:max-h-[95vh] max-md:w-[95%]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};

export default Modal;
