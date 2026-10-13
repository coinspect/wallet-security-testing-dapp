'use client';

import { Component } from 'react';

class WizardErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
    
    console.error('Wizard Error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ 
      hasError: false,
      error: null,
      errorInfo: null
    });
    if (this.props.onReset) {
      this.props.onReset();
    }

  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md w-full p-8 bg-white rounded-mdshadow-sm">
            <div className="mb-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 text-red-500">
                <svg 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900">
                Something went wrong
              </h2>
              <p className="mt-2 text-xs text-gray-600">
                An error occurred while processing your request.
              </p>
            </div>

            <div className="space-y-4">
              {process.env.NODE_ENV === 'development' && (
                <div className="p-1 bg-red-50 rounded-lg">
                  <p className="text-xs font-mono text-red-700">
                    {this.state.error?.toString()}
                  </p>
                </div>
              )}

              <div className="flex gap-4">
                <button
                  onClick={this.handleReset}
                  className="flex-1 px-4 py-2 text-xs font-medium text-white bg-blue-500 rounded-mdhover:bg-blue-600"
                >
                  Try Again
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-mdhover:bg-gray-200"
                >
                  Reload Page
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default WizardErrorBoundary;