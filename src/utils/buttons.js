export const handleCopyAccountClick = async (message,setIsCopied) => {
    if (!navigator.clipboard) {
      console.error('Clipboard API not available.');
      return;
    }

    try {
      await navigator.clipboard.writeText(message);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      return;
    }
  };