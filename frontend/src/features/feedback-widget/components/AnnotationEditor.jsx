import React, { useEffect, useState } from 'react';
import { Tldraw, exportToBlob } from 'tldraw';
import 'tldraw/tldraw.css';

const AnnotationEditor = ({ screenshot, metadata, onSave }) => {
  const [editor, setEditor] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editor || !screenshot) {
      return;
    }

    let isMounted = true;

    const loadScreenshot = async () => {
      try {
        setIsLoading(true);

        const img = new Image();
        img.src = screenshot;
        
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        if (!isMounted) return;

        // Convert data URL to blob
        const response = await fetch(screenshot);
        const blob = await response.blob();
        const file = new File([blob], 'screenshot.png', { type: 'image/png' });

        // Use the editor's putExternalContent method to add the image
        await editor.putExternalContent({
          type: 'files',
          files: [file],
          point: { x: 0, y: 0 },
          ignoreParent: false,
        });

        if (!isMounted) return;

        // Get the shape that was just created and lock it
        const shapes = editor.getCurrentPageShapes();
        const imageShape = shapes[shapes.length - 1];

        if (imageShape && imageShape.type === 'image') {
          editor.updateShape({
            ...imageShape,
            isLocked: true,
          });
        }

        // Zoom to fit
        setTimeout(() => {
          if (isMounted && editor) {
            editor.zoomToFit({ duration: 200 });
            setIsLoading(false);
          }
        }, 100);

      } catch (error) {
        console.error('Failed to load screenshot:', error);
        setIsLoading(false);
      }
    };

    loadScreenshot();

    return () => {
      isMounted = false;
    };
  }, [editor, screenshot]);

  const handleSave = async () => {
    // Validate description
    if (!description.trim()) {
      setError('Please provide a description');
      return;
    }

    if (description.trim().length < 10) {
      setError('Description must be at least 10 characters');
      return;
    }

    if (!editor) {
      const response = await fetch(screenshot);
      const blob = await response.blob();
      onSave(blob, screenshot, description);
      return;
    }

    try {
      const shapeIds = Array.from(editor.getCurrentPageShapeIds());
      
      if (shapeIds.length === 0) {
        const response = await fetch(screenshot);
        const blob = await response.blob();
        onSave(blob, screenshot, description);
        return;
      }

      const blob = await exportToBlob({
        editor,
        ids: shapeIds,
        format: 'png',
        opts: { 
          background: true,
          bounds: editor.getCurrentPageBounds(),
          scale: 1,
        },
      });

      const reader = new FileReader();
      reader.onloadend = () => {
        onSave(blob, reader.result, description);
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Failed to export annotation:', error);
      const response = await fetch(screenshot);
      const blob = await response.blob();
      onSave(blob, screenshot, description);
    }
  };

  // Custom tldraw components to hide unwanted UI
  const components = {
    PageMenu: null, // Remove page menu
    NavigationPanel: null, // Remove navigation panel (zoom controls)
  };

  // Custom tools - only keep the ones we want
  const tools = [
    'select',
    'draw',
    'arrow',
    'rectangle',
    'ellipse', 
    'text',
    'highlight',
  ];

  return (
    <div style={{ 
      display: 'flex', 
      gap: '24px', 
      height: '100%',
      minHeight: '600px'
    }}>
      {/* Left side - tldraw editor */}
      <div style={{ flex: '1 1 65%', position: 'relative' }}>
        {isLoading && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1000,
            background: 'white',
            padding: '20px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}>
            <div className="feedback-widget-spinner" />
            <p style={{ marginTop: '10px', fontSize: '14px', color: '#6b7280' }}>
              Loading screenshot...
            </p>
          </div>
        )}
        
        <div style={{ 
          width: '100%', 
          height: '100%',
          border: '2px solid #e5e7eb',
          borderRadius: '8px',
          overflow: 'hidden',
          background: '#f9fafb',
        }}>
          <Tldraw
            onMount={setEditor}
            autoFocus
            components={components}
          />
        </div>
      </div>

      {/* Right side - Description form */}
      <div style={{ 
        flex: '0 0 35%',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div>
          <h3 style={{ 
            margin: '0 0 8px', 
            fontSize: '18px',
            fontWeight: '600',
            color: '#111827',
            fontFamily: 'system-ui'
          }}>
            Describe the Issue
          </h3>
          <p style={{ 
            margin: '0 0 16px',
            fontSize: '14px',
            color: '#6b7280',
            fontFamily: 'system-ui'
          }}>
            Use the tools on the left to annotate the screenshot, then describe what you're seeing.
          </p>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <label htmlFor="feedback-description" style={{
            fontSize: '14px',
            fontWeight: '500',
            color: '#374151',
            marginBottom: '8px',
            fontFamily: 'system-ui'
          }}>
            Description <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <textarea
            id="feedback-description"
            placeholder="Please describe what you're seeing, what you expected, or any feedback you have..."
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setError('');
            }}
            maxLength={2000}
            style={{
              flex: 1,
              padding: '12px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              fontSize: '14px',
              fontFamily: 'system-ui',
              resize: 'none',
              minHeight: '200px'
            }}
          />
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            fontSize: '12px',
            color: '#9ca3af',
            marginTop: '4px'
          }}>
            <span>{error && <span style={{ color: '#ef4444' }}>{error}</span>}</span>
            <span>{description.length}/2000</span>
          </div>
        </div>

        <button
          type="button"
          className="feedback-widget-btn feedback-widget-btn-primary"
          onClick={handleSave}
          style={{ marginTop: 'auto', alignSelf: 'flex-start' }}
        >
          Submit Feedback
        </button>
      </div>
    </div>
  );
};

export default AnnotationEditor;
