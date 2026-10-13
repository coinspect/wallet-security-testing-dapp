
'use client';

export default function LoadingState() {
  return (
    <div className="min-h-screen flex items-center justify-center ">
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#4c7bff] border-t-transparent mx-auto mb-4"></div>
        <h3 className="text-lg font-medium text-gray-400">Loading...</h3>
        <p className="text-xs text-gray-400">Please wait while we process your request</p>
      </div>
    </div>
  );
}