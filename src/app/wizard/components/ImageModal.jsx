'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, MessageCircle, ChevronUp, Check } from 'lucide-react';

const Toast = ({ message }) => (
    <div
        className="animate-wsr-toast fixed bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-lg
                 flex items-center gap-2 z-[60]"
    >
        <Check className="w-4 h-4" />
        {message}
    </div>
);
const ImageModal = ({
    image,
    isOpen,
    onClose,
    annotation: initialAnnotation,
    onAnnotationChange,
    onPrevious,
    onNext,
    hasPrevious,
    hasNext
}) => {
    const [localAnnotation, setLocalAnnotation] = useState(initialAnnotation || '');
    const [isCommentsOpen, setIsCommentsOpen] = useState(false);
    const [showToast, setShowToast] = useState(false);
    useEffect(() => {
        setLocalAnnotation(initialAnnotation || '');
    }, [initialAnnotation]);

    const handleClickOutside = useCallback((e) => {
        if (e.target.classList.contains('modal-backdrop')) {
            onClose();
        }
    }, [onClose]);

    const handleAnnotationSave = () => {
        if (onAnnotationChange) {
            onAnnotationChange(localAnnotation);
            setShowToast(true);
            setTimeout(() => {
                setShowToast(false);
                setIsCommentsOpen(false);
            }, 2000);
        }
    };

    useEffect(() => {
        document.body.style.overflow = isOpen ? 'hidden' : 'unset';
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center modal-backdrop"
            onClick={handleClickOutside}
        >
            <div className="w-full max-w-[600px] mx-4 max-h-[90vh] overflow-y-auto bg-dark-base rounded-lg shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 bg-dark-surface">
                    <span className="text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Detailed Image View
                    </span>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white 
                                 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Image container */}
                <div className="relative bg-dark-surface/50">
                    <div className={`flex justify-center items-center p-4 transition-all duration-300
                                  ${isCommentsOpen ? 'h-[40vh] sm:h-[400px]' : 'h-[60vh] sm:h-[800px]'}`}>
                        {/* Evidence can be a runtime data URL, so it cannot use Next's image pipeline. */}
                        <img
                            src={image}
                            alt="Evidence"
                            className="max-h-full max-w-full object-contain rounded"
                        />
                    </div>

                    {/* Navigation buttons */}
                    {hasPrevious && (
                        <button
                            onClick={onPrevious}
                            className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 
                                     rounded-full bg-black/50 text-white hover:bg-black/70 
                                     transition-all transform hover:scale-105"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                    )}

                    {hasNext && (
                        <button
                            onClick={onNext}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 
                                     rounded-full bg-black/50 text-white hover:bg-black/70 
                                     transition-all transform hover:scale-105"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    )}
                </div>

                {/* Comments toggle button */}
                <button
                    onClick={() => setIsCommentsOpen(!isCommentsOpen)}
                    className="w-full px-4 py-2 bg-dark-surface text-gray-300 hover:text-white
         flex items-center justify-center gap-2 transition-colors"
                >
                    {isCommentsOpen ? (
                        <>
                            <ChevronUp className="w-4 h-4" />
                            Hide Comments
                        </>
                    ) : (
                        <>
                            <MessageCircle className="w-4 h-4" />
                            Add Comment
                        </>
                    )}
                </button>

                {/* Comments section */}
                {isCommentsOpen && (
                    <div className="p-4 bg-dark-base">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-gray-300 uppercase tracking-wider">
                                Verification Comments
                            </span>
                            <span className="text-xs text-gray-500">
                                {localAnnotation.length}/200 characters
                            </span>
                        </div>
                        
                        <textarea
                            value={localAnnotation}
                            onChange={(e) => setLocalAnnotation(e.target.value.slice(0, 200))}
                            placeholder="Add a note about this image..."
                            className="w-full px-3 py-2 mb-3 bg-dark-surface text-gray-200 
         border border-gray-700 rounded-lg text-sm
         placeholder:text-gray-500 resize-none
         focus:ring-1 focus:ring-primary-dark focus:border-primary-dark
         transition-colors"
                            rows={3}
                        />

                        <button
                            onClick={handleAnnotationSave}
                            className="w-full px-4 py-2 bg-primary-dark text-white rounded-lg
         hover:bg-primary-dark/90 transition-colors text-sm font-medium
         shadow-lg shadow-primary-dark/20"
                        >
                            Save Annotation
                        </button>
                    </div>
                )}
            </div>
            {showToast && <Toast message="Comment saved successfully!" />}
        </div>
    );
};

export default ImageModal;
