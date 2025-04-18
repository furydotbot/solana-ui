import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, ChevronRight, DollarSign, X, Info, Search } from 'lucide-react';
import { getWallets } from './Utils';
import { useToast } from "./Notifications";
import { loadConfigFromCookies } from './Utils';
import * as web3 from '@solana/web3.js';
import bs58 from 'bs58';

const STEPS_CUSTOMBUY = ['Select Wallets', 'Configure Buy', 'Review'];

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CustomBuyModalProps extends BaseModalProps { 
  onCustomBuy: (data: any) => void;
  handleRefresh: () => void;
  tokenAddress: string;
  solBalances: Map<string, number>;
  tokenBalances: Map<string, number>;
}

// Interface for transactions bundle
interface TransactionBundle {
  transactions: string[]; // Base58 encoded transaction data
}

export const CustomBuyModal: React.FC<CustomBuyModalProps> = ({
  isOpen,
  onClose,
  onCustomBuy,
  handleRefresh,
  tokenAddress,
  solBalances,
  tokenBalances
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedWallets, setSelectedWallets] = useState<string[]>([]);
  const [walletAmounts, setWalletAmounts] = useState<Record<string, string>>({}); // Individual amounts per wallet
  const [useRpc, setUseRpc] = useState<boolean>(false); // Toggle for useRpc
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [tokenInfo, setTokenInfo] = useState<{ symbol: string } | null>(null);
  const [isLoadingTokenInfo, setIsLoadingTokenInfo] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInfoTip, setShowInfoTip] = useState(false);
  const [sortOption, setSortOption] = useState('address');
  const [sortDirection, setSortDirection] = useState('asc');
  const [balanceFilter, setBalanceFilter] = useState('all');
  const [bulkAmount, setBulkAmount] = useState('0.1');

  const wallets = getWallets();
  const { showToast } = useToast();

  // Format SOL balance for display
  const formatSolBalance = (balance: number) => {
    return balance.toFixed(4);
  };

  // Format token balance for display
  const formatTokenBalance = (balance: number | undefined) => {
    if (balance === undefined) return '0';
    // Use different formatting logic for very small or very large numbers
    if (balance < 0.001 && balance > 0) {
      return balance.toExponential(4);
    }
    return balance.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };
  
  // Filter wallets based on search term, sort option, and balance filter
  const filteredWallets = useMemo(() => {
    if (!wallets) return [];
    
    // Apply search filter
    let filtered = wallets;
    if (searchTerm) {
      filtered = filtered.filter(wallet => 
        wallet.address.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Always filter out wallets with zero SOL balance
    filtered = filtered.filter(wallet => (solBalances.get(wallet.address) || 0) > 0);
    
    // Apply additional balance filter
    if (balanceFilter !== 'all') {
      if (balanceFilter === 'highBalance') {
        filtered = filtered.filter(wallet => (solBalances.get(wallet.address) || 0) >= 0.1);
      } else if (balanceFilter === 'lowBalance') {
        filtered = filtered.filter(wallet => {
          const balance = solBalances.get(wallet.address) || 0;
          return balance < 0.1;
        });
      } else if (balanceFilter === 'hasToken') {
        filtered = filtered.filter(wallet => (tokenBalances.get(wallet.address) || 0) > 0);
      } else if (balanceFilter === 'noToken') {
        filtered = filtered.filter(wallet => (tokenBalances.get(wallet.address) || 0) === 0);
      }
    }
    
    // Sort wallets
    return filtered.sort((a, b) => {
      if (sortOption === 'address') {
        return sortDirection === 'asc' 
          ? a.address.localeCompare(b.address)
          : b.address.localeCompare(a.address);
      } else if (sortOption === 'balance') {
        const balanceA = solBalances.get(a.address) || 0;
        const balanceB = solBalances.get(b.address) || 0;
        return sortDirection === 'asc' ? balanceA - balanceB : balanceB - balanceA;
      } else if (sortOption === 'tokenBalance') {
        const balanceA = tokenBalances.get(a.address) || 0;
        const balanceB = tokenBalances.get(b.address) || 0;
        return sortDirection === 'asc' ? balanceA - balanceB : balanceB - balanceA;
      }
      return 0;
    });
  }, [wallets, searchTerm, balanceFilter, sortOption, sortDirection, solBalances, tokenBalances]);

  useEffect(() => {
    if (isOpen) {
      resetForm();
      handleRefresh();
    }
  }, [isOpen, tokenAddress]);

  // Initialize wallet amounts when wallets are selected/deselected
  useEffect(() => {
    const newWalletAmounts = { ...walletAmounts };
    
    // Add new wallets with default amount
    selectedWallets.forEach(wallet => {
      if (!newWalletAmounts[wallet]) {
        newWalletAmounts[wallet] = '0.1';
      }
    });
    
    // Remove unselected wallets
    Object.keys(newWalletAmounts).forEach(wallet => {
      if (!selectedWallets.includes(wallet)) {
        delete newWalletAmounts[wallet];
      }
    });
    
    setWalletAmounts(newWalletAmounts);
  }, [selectedWallets]);

  const resetForm = () => {
    setSelectedWallets([]);
    setWalletAmounts({});
    setUseRpc(false);
    setIsConfirmed(false);
    setCurrentStep(0);
    setSearchTerm('');
    setBulkAmount('0.1');
    setSortOption('address');
    setSortDirection('asc');
    setBalanceFilter('all');
  };

  // Helper to get wallet address from private key
  const getWalletAddressFromKey = (privateKey: string): string => {
    const wallet = wallets.find(w => w.privateKey === privateKey);
    return wallet ? wallet.address : '';
  };

  // Get unsigned transactions from the backend
  const getUnsignedTransactions = async (
    walletAddresses: string[],
    amounts: number[],
    useRpcSetting: boolean
  ): Promise<TransactionBundle[]> => {
    try {
      const baseUrl = (window as any).tradingServerUrl.replace(/\/+$/, '');
      
      const response = await fetch(`${baseUrl}/api/tokens/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddresses,
          tokenAddress,
          solAmount: 0.1, // Default amount, will be overridden by amounts array
          protocol: "jupiter",
          amounts,
          useRpc: useRpcSetting
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to get unsigned transactions');
      }
      
      // Handle different response formats to ensure compatibility
      if (data.bundles && Array.isArray(data.bundles)) {
        // Wrap any bundle that is a plain array
        return data.bundles.map((bundle: any) =>
          Array.isArray(bundle) ? { transactions: bundle } : bundle
        );
      } else if (data.transactions && Array.isArray(data.transactions)) {
        // If we get a flat array of transactions, create a single bundle
        return [{ transactions: data.transactions }];
      } else if (Array.isArray(data)) {
        // Legacy format where data itself is an array
        return [{ transactions: data }];
      } else {
        throw new Error('No transactions returned from backend');
      }
    } catch (error) {
      console.error('Error getting unsigned transactions:', error);
      throw error;
    }
  };

  // Sign transactions on the frontend
  const signTransactions = (
    bundle: TransactionBundle,
    privateKeys: string[]
  ): TransactionBundle => {
    // Check if the bundle has a valid transactions array
    if (!bundle.transactions || !Array.isArray(bundle.transactions)) {
      console.error("Invalid bundle format, transactions property is missing or not an array:", bundle);
      return { transactions: [] };
    }

    // Create keypairs from private keys
    const walletKeypairs = privateKeys.map(privateKey => 
      web3.Keypair.fromSecretKey(bs58.decode(privateKey))
    );

    const signedTransactions = bundle.transactions.map(txBase58 => {
      // Deserialize transaction
      const txBuffer = bs58.decode(txBase58);
      const transaction = web3.VersionedTransaction.deserialize(txBuffer);
      
      // Extract required signers from staticAccountKeys
      const signers: web3.Keypair[] = [];
      for (const accountKey of transaction.message.staticAccountKeys) {
        const pubkeyStr = accountKey.toBase58();
        const matchingKeypair = walletKeypairs.find(
          kp => kp.publicKey.toBase58() === pubkeyStr
        );
        if (matchingKeypair && !signers.includes(matchingKeypair)) {
          signers.push(matchingKeypair);
        }
      }
      
      // Sign the transaction
      transaction.sign(signers);
      
      // Serialize and encode the fully signed transaction
      return bs58.encode(transaction.serialize());
    });
    
    return { transactions: signedTransactions };
  };

  // Send signed transactions to the backend
  const sendSignedTransactions = async (
    signedBundles: TransactionBundle[],
    useRpcSetting: boolean
  ): Promise<any> => {
    try {
      const baseUrl = (window as any).tradingServerUrl.replace(/\/+$/, '');
      
      // Use the new unified endpoint
      const endpoint = '/api/transactions/send';
      
      // Prepare all bundles for sending
      const sendPromises = signedBundles.map(async (bundle) => {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactions: bundle.transactions,
            useRpc: useRpcSetting
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }

        return response.json();
      });
      
      // Wait for all bundles to be sent
      return Promise.all(sendPromises);
    } catch (error) {
      console.error('Error sending signed transactions:', error);
      throw error;
    }
  };

  const handleNext = () => {
    // Step validations
    if (currentStep === 0) {
      if (selectedWallets.length === 0) {
        showToast('Please select at least one wallet', 'error');
        return;
      }
    }
    if (currentStep === 1) {
      // Check if any wallet has an invalid amount
      const hasInvalidAmount = Object.values(walletAmounts).some(
        amount => !amount || parseFloat(amount) <= 0
      );
      
      if (hasInvalidAmount) {
        showToast('Please enter valid amounts for all wallets', 'error');
        return;
      }
    }
    
    setCurrentStep((prev) => Math.min(prev + 1, STEPS_CUSTOMBUY.length - 1));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  // Updated handleCustomBuy function that doesn't send private keys to the server
  const handleCustomBuy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmed) return;
    setIsSubmitting(true);
    
    try {
      // Map wallets to addresses
      const walletAddresses = selectedWallets.map(privateKey => 
        getWalletAddressFromKey(privateKey)
      );
      
      // Map wallet amounts to numeric values
      const amounts = selectedWallets.map(wallet => parseFloat(walletAmounts[wallet]));
      
      // 1. Get unsigned transactions from backend
      const unsignedBundles = await getUnsignedTransactions(
        walletAddresses,
        amounts,
        useRpc
      );
      
      console.log(`Received ${unsignedBundles.length} unsigned transaction bundles`);
      
      // 2. Sign transactions on the frontend
      const signedBundles = unsignedBundles.map(bundle => 
        signTransactions(bundle, selectedWallets)
      );
      
      console.log(`Signed ${signedBundles.length} transaction bundles`);
      
      // 3. Send signed transactions to backend
      const results = await sendSignedTransactions(signedBundles, useRpc);
      
      console.log('Transaction results:', results);
      
      showToast('Custom buy operation completed successfully', 'success');
      resetForm();
      onClose();
      handleRefresh(); // Refresh balances
    } catch (error) {
      console.error('Custom buy execution error:', error);
      showToast(`Custom buy operation failed: ${error.message}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to handle wallet selection
  const toggleWalletSelection = (privateKey: string) => {
    setSelectedWallets(prev => {
      if (prev.includes(privateKey)) {
        return prev.filter(key => key !== privateKey);
      } else {
        return [...prev, privateKey];
      }
    });
  };

  // Helper to handle select/deselect all wallets
  const handleSelectAllWallets = () => {
    if (selectedWallets.length === filteredWallets.length) {
      // If all are selected, deselect all
      setSelectedWallets([]);
    } else {
      // Otherwise, select all
      setSelectedWallets(filteredWallets.map(w => w.privateKey));
    }
  };

  // Helper to update amount for a specific wallet
  const handleWalletAmountChange = (wallet: string, value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setWalletAmounts(prev => ({
        ...prev,
        [wallet]: value
      }));
    }
  };

  // Set the same amount for all wallets
  const setAmountForAllWallets = () => {
    if (bulkAmount === '' || parseFloat(bulkAmount) <= 0) return;
    
    const newAmounts = { ...walletAmounts };
    
    selectedWallets.forEach(wallet => {
      newAmounts[wallet] = bulkAmount;
    });
    
    setWalletAmounts(newAmounts);
  };

  // Calculate total buy amount across all wallets
  const calculateTotalBuyAmount = () => {
    return selectedWallets.reduce((total, wallet) => {
      return total + parseFloat(walletAmounts[wallet] || '0');
    }, 0).toFixed(4);
  };

  // Format wallet address for display
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };
  
  // Get wallet display from private key
  const getWalletDisplayFromKey = (privateKey: string) => {
    const wallet = wallets.find(w => w.privateKey === privateKey);
    return wallet 
      ? formatAddress(wallet.address)
      : privateKey.slice(0, 8);
  };

  // Get wallet balance
  const getWalletBalance = (address: string): number => {
    return solBalances.has(address) ? (solBalances.get(address) ?? 0) : 0;
  };

  // Get wallet token balance
  const getWalletTokenBalance = (address: string): number => {
    return tokenBalances.has(address) ? (tokenBalances.get(address) ?? 0) : 0;
  };

  // Add cyberpunk style element to document head
  useEffect(() => {
    if (isOpen) {
      const modalStyleElement = document.createElement('style');
      modalStyleElement.textContent = `
        @keyframes modal-pulse {
          0% { box-shadow: 0 0 5px rgba(2, 179, 109, 0.5), 0 0 15px rgba(2, 179, 109, 0.2); }
          50% { box-shadow: 0 0 15px rgba(2, 179, 109, 0.8), 0 0 25px rgba(2, 179, 109, 0.4); }
          100% { box-shadow: 0 0 5px rgba(2, 179, 109, 0.5), 0 0 15px rgba(2, 179, 109, 0.2); }
        }
        
        @keyframes modal-fade-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        
        @keyframes modal-slide-up {
          0% { transform: translateY(20px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        
        @keyframes modal-scan-line {
          0% { transform: translateY(-100%); opacity: 0.3; }
          100% { transform: translateY(100%); opacity: 0; }
        }
        
        .modal-cyberpunk-container {
          animation: modal-fade-in 0.3s ease;
        }
        
        .modal-cyberpunk-content {
          animation: modal-slide-up 0.4s ease;
          position: relative;
        }
        
        .modal-cyberpunk-content::before {
          content: "";
          position: absolute;
          width: 100%;
          height: 5px;
          background: linear-gradient(to bottom, 
            transparent 0%,
            rgba(2, 179, 109, 0.2) 50%,
            transparent 100%);
          z-index: 10;
          animation: modal-scan-line 8s linear infinite;
          pointer-events: none;
        }
        
        .modal-glow {
          animation: modal-pulse 4s infinite;
        }
        
        .modal-input-cyberpunk:focus {
          box-shadow: 0 0 0 1px rgba(2, 179, 109, 0.7), 0 0 15px rgba(2, 179, 109, 0.5);
          transition: all 0.3s ease;
        }
        
        .modal-btn-cyberpunk {
          position: relative;
          overflow: hidden;
          transition: all 0.3s ease;
        }
        
        .modal-btn-cyberpunk::after {
          content: "";
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: linear-gradient(
            to bottom right,
            rgba(2, 179, 109, 0) 0%,
            rgba(2, 179, 109, 0.3) 50%,
            rgba(2, 179, 109, 0) 100%
          );
          transform: rotate(45deg);
          transition: all 0.5s ease;
          opacity: 0;
        }
        
        .modal-btn-cyberpunk:hover::after {
          opacity: 1;
          transform: rotate(45deg) translate(50%, 50%);
        }
        
        .modal-btn-cyberpunk:active {
          transform: scale(0.95);
        }
        
        .progress-bar-cyberpunk {
          position: relative;
          overflow: hidden;
        }
        
        .progress-bar-cyberpunk::after {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(2, 179, 109, 0.7) 50%,
            transparent 100%
          );
          width: 100%;
          height: 100%;
          transform: translateX(-100%);
          animation: progress-shine 3s infinite;
        }
        
        @keyframes progress-shine {
          0% { transform: translateX(-100%); }
          20% { transform: translateX(100%); }
          100% { transform: translateX(100%); }
        }
        
        .glitch-text:hover {
          text-shadow: 0 0 2px #02b36d, 0 0 4px #02b36d;
          animation: glitch 2s infinite;
        }
        
        @keyframes glitch {
          2%, 8% { transform: translate(-2px, 0) skew(0.3deg); }
          4%, 6% { transform: translate(2px, 0) skew(-0.3deg); }
          62%, 68% { transform: translate(0, 0) skew(0.33deg); }
          64%, 66% { transform: translate(0, 0) skew(-0.33deg); }
        }
      `;
      document.head.appendChild(modalStyleElement);
      
      return () => {
        document.head.removeChild(modalStyleElement);
      };
    }
  }, [isOpen]);

  // Render cyberpunk styled steps
  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        // Select Wallets
        return (
          <div className="space-y-5 animate-[fadeIn_0.3s_ease]">
            <div className="flex items-center mb-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[#02b36d20] mr-3">
                <svg
                  className="w-5 h-5 text-[#02b36d]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <path d="M16 10h2M6 14h12" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-[#e4fbf2] font-mono tracking-wider">
                <span className="text-[#02b36d]">/</span> SELECT WALLETS <span className="text-[#02b36d]">/</span>
              </h3>
            </div>
            
            <div>
              <div className="mb-4 p-4 bg-[#091217] rounded-lg border border-[#02b36d40] relative overflow-hidden">
                <div className="absolute inset-0 z-0 opacity-10"
                     style={{
                       backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                       backgroundSize: '20px 20px',
                       backgroundPosition: 'center center',
                     }}>
                </div>
                <h4 className="text-sm font-medium text-[#02b36d] mb-2 font-mono tracking-wider relative z-10">TOKEN INFORMATION</h4>
                <div className="text-sm text-[#e4fbf2] relative z-10 font-mono">
                  <span className="text-[#7ddfbd]">ADDRESS: </span>
                  {tokenAddress}
                </div>
              </div>
              
              <div className="group mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-[#7ddfbd] group-hover:text-[#02b36d] transition-colors duration-200 font-mono uppercase tracking-wider">
                    <span className="text-[#02b36d]">&#62;</span> Available Wallets <span className="text-[#02b36d]">&#60;</span>
                  </label>
                  <button 
                    onClick={handleSelectAllWallets}
                    className="text-xs px-3 py-1 bg-[#091217] hover:bg-[#0a1419] text-[#7ddfbd] hover:text-[#02b36d] rounded border border-[#02b36d30] hover:border-[#02b36d] transition-all font-mono tracking-wider modal-btn-cyberpunk"
                  >
                    {selectedWallets.length === filteredWallets.length ? 'DESELECT ALL' : 'SELECT ALL'}
                  </button>
                </div>
                
                <div className="mb-3 flex space-x-2">
                  <div className="relative flex-grow">
                    <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#7ddfbd]" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-[#091217] border border-[#02b36d30] rounded-lg text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] transition-all modal-input-cyberpunk font-mono"
                      placeholder="SEARCH WALLETS..."
                    />
                  </div>
                  
                  <select 
                    className="bg-[#091217] border border-[#02b36d30] rounded-lg px-2 text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] modal-input-cyberpunk font-mono"
                    value={sortOption}
                    onChange={(e) => setSortOption(e.target.value)}
                  >
                    <option value="address">ADDRESS</option>
                    <option value="balance">SOL BALANCE</option>
                    <option value="tokenBalance">TOKEN BALANCE</option>
                  </select>
                  
                  <button
                    className="p-2 bg-[#091217] border border-[#02b36d30] rounded-lg text-[#7ddfbd] hover:text-[#02b36d] hover:border-[#02b36d] transition-all modal-btn-cyberpunk"
                    onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                  >
                    {sortDirection === 'asc' ? '↑' : '↓'}
                  </button>
                  
                  <select 
                    className="bg-[#091217] border border-[#02b36d30] rounded-lg px-2 text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] modal-input-cyberpunk font-mono"
                    value={balanceFilter}
                    onChange={(e) => setBalanceFilter(e.target.value)}
                  >
                    <option value="all">ALL BALANCES</option>
                    <option value="highBalance">HIGH SOL</option>
                    <option value="lowBalance">LOW SOL</option>
                    <option value="hasToken">HAS TOKEN</option>
                    <option value="noToken">NO TOKEN</option>
                  </select>
                </div>
              </div>
              
              <div className="max-h-64 overflow-y-auto border border-[#02b36d20] rounded-lg shadow-inner bg-[#091217] transition-all duration-200 hover:border-[#02b36d40] scrollbar-thin">
                {filteredWallets.length > 0 ? (
                  filteredWallets.map((wallet) => (
                    <div
                      key={wallet.id}
                      onClick={() => toggleWalletSelection(wallet.privateKey)}
                      className={`flex items-center p-2.5 hover:bg-[#0a1419] cursor-pointer transition-all duration-200 border-b border-[#02b36d20] last:border-b-0
                                ${selectedWallets.includes(wallet.privateKey) ? 'bg-[#02b36d10] border-[#02b36d30]' : ''}`}
                    >
                      <div className={`w-5 h-5 mr-3 rounded flex items-center justify-center transition-all duration-300
                                      ${selectedWallets.includes(wallet.privateKey)
                                        ? 'bg-[#02b36d] shadow-md shadow-[#02b36d40]' 
                                        : 'border border-[#02b36d30] bg-[#091217]'}`}>
                        {selectedWallets.includes(wallet.privateKey) && (
                          <CheckCircle size={14} className="text-[#050a0e] animate-[fadeIn_0.2s_ease]" />
                        )}
                      </div>
                      <div className="flex-1 flex flex-col">
                        <span className="font-mono text-sm text-[#e4fbf2] glitch-text">{formatAddress(wallet.address)}</span>
                        <div className="flex items-center gap-3 mt-0.5">
                          <div className="flex items-center">
                            <DollarSign size={12} className="text-[#7ddfbd] mr-1" />
                            <span className="text-xs text-[#7ddfbd] font-mono">{formatSolBalance(getWalletBalance(wallet.address) || 0)} SOL</span>
                          </div>
                          <div className="flex items-center">
                            <svg className="w-3 h-3 text-[#02b36d] mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10" />
                              <path d="M12 8v8M8 12h8" />
                            </svg>
                            <span className="text-xs text-[#02b36d] font-mono">{formatTokenBalance(tokenBalances.get(wallet.address))} TOKEN</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-3 text-sm text-[#7ddfbd] text-center font-mono">
                    NO WALLETS FOUND MATCHING FILTERS
                  </div>
                )}
              </div>
              
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-[#7ddfbd] font-mono">
                  SELECTED: <span className="text-[#02b36d] font-medium">{selectedWallets.length}</span> WALLETS
                </span>
              </div>
            </div>
          </div>
        );
        
      case 1:
        // Configure Buy
        return (
          <div className="space-y-5 animate-[fadeIn_0.3s_ease]">
            <div className="flex items-center mb-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[#02b36d20] mr-3">
                <svg
                  className="w-5 h-5 text-[#02b36d]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v12M6 12h12" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-[#e4fbf2] font-mono tracking-wider">
                <span className="text-[#02b36d]">/</span> CONFIGURE BUY <span className="text-[#02b36d]">/</span>
              </h3>
            </div>
            
            {/* Bulk amount setter */}
            <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden">
              <div className="absolute inset-0 z-0 opacity-5"
                   style={{
                     backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                     backgroundSize: '20px 20px',
                     backgroundPosition: 'center center',
                   }}>
              </div>
              <div className="flex items-center justify-between mb-1 relative z-10">
                <div className="flex items-center gap-1">
                  <label className="text-sm text-[#7ddfbd] font-mono tracking-wider">
                    SET AMOUNT FOR ALL WALLETS (SOL)
                  </label>
                  <div className="relative" onMouseEnter={() => setShowInfoTip(true)} onMouseLeave={() => setShowInfoTip(false)}>
                    <Info size={14} className="text-[#7ddfbd] cursor-help" />
                    {showInfoTip && (
                      <div className="absolute left-0 bottom-full mb-2 p-2 bg-[#091217] border border-[#02b36d30] rounded shadow-lg text-xs text-[#e4fbf2] w-48 z-10 font-mono">
                        AMOUNT IN SOL TO USE FOR EACH WALLET
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center">
                  <div className="relative">
                    <DollarSign size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#7ddfbd]" />
                    <input
                      type="text"
                      value={bulkAmount}
                      placeholder="0.1"
                      className="w-32 pl-8 pr-2 py-1.5 bg-[#050a0e] border border-[#02b36d30] rounded text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] transition-all modal-input-cyberpunk font-mono"
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setBulkAmount(value);
                        }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="ml-2 bg-[#02b36d] text-xs rounded px-3 py-1.5 hover:bg-[#01a35f] text-[#050a0e] transition-colors font-mono tracking-wider modal-btn-cyberpunk"
                    onClick={setAmountForAllWallets}
                  >
                    APPLY TO ALL
                  </button>
                </div>
              </div>
            </div>
            
            {/* Individual wallet amounts */}
            <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden">
              <div className="absolute inset-0 z-0 opacity-5"
                   style={{
                     backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                     backgroundSize: '20px 20px',
                     backgroundPosition: 'center center',
                   }}>
              </div>
              <h4 className="text-sm font-medium text-[#7ddfbd] mb-3 font-mono tracking-wider relative z-10">INDIVIDUAL WALLET AMOUNTS</h4>
              <div className="max-h-64 overflow-y-auto pr-1 scrollbar-thin relative z-10">
                {selectedWallets.map((privateKey, index) => {
                  const address = getWalletAddressFromKey(privateKey);
                  const solBalance = getWalletBalance(address);
                  const tokenBalance = getWalletTokenBalance(address);
                  
                  return (
                    <div key={privateKey} className="flex items-center justify-between py-2 border-b border-[#02b36d30] last:border-b-0">
                      <div className="flex items-center">
                        <span className="text-[#7ddfbd] text-xs mr-2 w-6 font-mono">{index + 1}.</span>
                        <span className="font-mono text-sm text-[#e4fbf2] glitch-text">{getWalletDisplayFromKey(privateKey)}</span>
                      </div>
                      <div className="flex items-center space-x-3">
                        <div className="flex flex-col items-end">
                          <span className="text-xs text-[#7ddfbd] font-mono">SOL: {formatSolBalance(solBalance)}</span>
                          <span className="text-xs text-[#02b36d] font-mono">TOKEN: {formatTokenBalance(tokenBalance)}</span>
                        </div>
                        <div className="flex items-center">
                          <div className="relative">
                            <DollarSign size={12} className="absolute left-2 top-1/2 transform -translate-y-1/2 text-[#7ddfbd]" />
                            <input
                              type="text"
                              value={walletAmounts[privateKey] || '0.1'}
                              onChange={(e) => handleWalletAmountChange(privateKey, e.target.value)}
                              className="w-24 pl-7 pr-2 py-1.5 bg-[#050a0e] border border-[#02b36d30] rounded text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] transition-all modal-input-cyberpunk font-mono"
                              placeholder="0.1"
                            />
                          </div>
                          <span className="text-xs text-[#7ddfbd] ml-2 font-mono">SOL</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            {/* Use RPC toggle */}
            <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden">
              <div className="absolute inset-0 z-0 opacity-5"
                   style={{
                     backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                     backgroundSize: '20px 20px',
                     backgroundPosition: 'center center',
                   }}>
              </div>
              <div className="flex items-center justify-between relative z-10">
                <label className="text-sm text-[#7ddfbd] font-mono tracking-wider">
                  USE RPC
                </label>
                <div 
                  onClick={() => setUseRpc(!useRpc)}
                  className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                    useRpc ? "bg-[#02b36d]" : "bg-[#091217] border border-[#02b36d40]"
                  }`}
                >
                  <div
                    className={`bg-[#e4fbf2] w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      useRpc ? "translate-x-6" : "translate-x-0"
                    }`}
                  />
                </div>
              </div>
              <div className="text-xs text-[#7ddfbd] mt-2 font-mono relative z-10">
                TOGGLE TO USE RPC FOR THIS TRANSACTION
              </div>
            </div>
            
            {/* Total summary */}
            <div className="bg-[#02b36d10] border border-[#02b36d40] rounded-lg p-4 modal-glow">
              <div className="flex justify-between">
                <span className="text-sm font-medium text-[#02b36d] font-mono tracking-wider">TOTAL BUY AMOUNT:</span>
                <span className="text-sm font-medium text-[#02b36d] font-mono tracking-wider">
                  {calculateTotalBuyAmount()} SOL
                </span>
              </div>
            </div>
          </div>
        );
        
      case 2:
        // Review Operation
        return (
          <div className="space-y-5 animate-[fadeIn_0.3s_ease]">
            <div className="flex items-center mb-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[#02b36d20] mr-3">
                <svg
                  className="w-5 h-5 text-[#02b36d]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-[#e4fbf2] font-mono tracking-wider">
                <span className="text-[#02b36d]">/</span> REVIEW OPERATION <span className="text-[#02b36d]">/</span>
              </h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left column - Token and Operation Details */}
              <div className="space-y-4">
                {/* Token Details */}
                <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden">
                  <div className="absolute inset-0 z-0 opacity-5"
                       style={{
                         backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                         backgroundSize: '20px 20px',
                         backgroundPosition: 'center center',
                       }}>
                  </div>
                  <h4 className="text-sm font-medium text-[#02b36d] mb-3 font-mono tracking-wider relative z-10">
                    TOKEN DETAILS
                  </h4>
                  <div className="space-y-2 relative z-10">
                    <div>
                      <span className="text-sm text-[#7ddfbd] font-mono">
                        ADDRESS:
                      </span>
                      <span className="text-sm text-[#e4fbf2] ml-2 font-mono">
                        {`${tokenAddress.slice(0, 8)}...${tokenAddress.slice(-8)}`}
                      </span>
                    </div>
                    <div>
                      <span className="text-sm text-[#7ddfbd] font-mono">
                        SYMBOL:
                      </span>
                      <span className="text-sm text-[#e4fbf2] ml-2 font-mono">
                        {tokenInfo?.symbol || 'UNKNOWN'}
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Operation Summary */}
                <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden">
                  <div className="absolute inset-0 z-0 opacity-5"
                       style={{
                         backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                         backgroundSize: '20px 20px',
                         backgroundPosition: 'center center',
                       }}>
                  </div>
                  <h4 className="text-sm font-medium text-[#02b36d] mb-3 font-mono tracking-wider relative z-10">
                    OPERATION DETAILS
                  </h4>
                  <div className="space-y-2 relative z-10">
                    <div className="flex justify-between py-1.5 border-b border-[#02b36d30]">
                      <span className="text-sm text-[#7ddfbd] font-mono">USE RPC: </span>
                      <span className="text-sm text-[#e4fbf2] font-medium font-mono">{useRpc ? 'YES' : 'NO'}</span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-[#02b36d30]">
                      <span className="text-sm text-[#7ddfbd] font-mono">TOTAL WALLETS: </span>
                      <span className="text-sm text-[#e4fbf2] font-medium font-mono">{selectedWallets.length}</span>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <span className="text-sm text-[#7ddfbd] font-mono">TOTAL BUY AMOUNT: </span>
                      <span className="text-sm text-[#02b36d] font-medium font-mono">
                        {calculateTotalBuyAmount()} SOL
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Confirmation */}
                <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden">
                  <div className="absolute inset-0 z-0 opacity-5"
                       style={{
                         backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                         backgroundSize: '20px 20px',
                         backgroundPosition: 'center center',
                       }}>
                  </div>
                  <div className="flex items-start gap-3 relative z-10">
                    <div className="relative mt-1">
                      <input
                        type="checkbox"
                        id="confirm"
                        checked={isConfirmed}
                        onChange={(e) => setIsConfirmed(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="w-5 h-5 border border-[#02b36d40] rounded-md peer-checked:bg-[#02b36d] peer-checked:border-0 transition-all"></div>
                      <CheckCircle size={14} className={`absolute top-0.5 left-0.5 text-[#050a0e] transition-all ${isConfirmed ? 'opacity-100' : 'opacity-0'}`} />
                    </div>
                    <label htmlFor="confirm" className="text-sm text-[#7ddfbd] leading-relaxed font-mono">
                      I CONFIRM THAT I WANT TO BUY {tokenInfo?.symbol || 'TOKEN'} USING THE SPECIFIED AMOUNTS
                      ACROSS {selectedWallets.length} WALLETS WITH USERPC SET TO {useRpc ? 'ENABLED' : 'DISABLED'}. THIS ACTION CANNOT BE UNDONE.
                    </label>
                  </div>
                </div>
              </div>
              
              {/* Right column - Selected Wallets */}
              <div>
                <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] h-full relative overflow-hidden">
                  <div className="absolute inset-0 z-0 opacity-5"
                       style={{
                         backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                         backgroundSize: '20px 20px',
                         backgroundPosition: 'center center',
                       }}>
                  </div>
                  <h4 className="text-sm font-medium text-[#02b36d] mb-3 font-mono tracking-wider relative z-10">
                    SELECTED WALLETS
                  </h4>
                  
                  <div className="max-h-64 overflow-y-auto pr-1 scrollbar-thin relative z-10">
                    {selectedWallets.map((privateKey, index) => {
                      const address = getWalletAddressFromKey(privateKey);
                      const solBalance = getWalletBalance(address);
                      const tokenBalance = getWalletTokenBalance(address);
                      
                      return (
                        <div key={privateKey} className="flex justify-between py-1.5 border-b border-[#02b36d30] last:border-b-0">
                          <div className="flex items-center">
                            <span className="text-[#7ddfbd] text-xs mr-2 w-6 font-mono">{index + 1}.</span>
                            <div className="flex flex-col">
                              <span className="font-mono text-sm text-[#e4fbf2] glitch-text">{getWalletDisplayFromKey(privateKey)}</span>
                              <div className="flex space-x-2 text-xs">
                                <span className="text-[#7ddfbd] font-mono">SOL: {formatSolBalance(solBalance)}</span>
                                <span className="text-[#02b36d] font-mono">TOKEN: {formatTokenBalance(tokenBalance)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end justify-center">
                            <span className="text-[#02b36d] font-medium font-mono">{walletAmounts[privateKey]} SOL</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
        
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm modal-cyberpunk-container" style={{backgroundColor: 'rgba(5, 10, 14, 0.85)'}}>
      <div className="relative bg-[#050a0e] border border-[#02b36d40] rounded-lg shadow-lg w-full max-w-5xl md:h-auto overflow-hidden transform modal-cyberpunk-content modal-glow">
        {/* Ambient grid background */}
        <div className="absolute inset-0 z-0 opacity-10"
             style={{
               backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
               backgroundSize: '20px 20px',
               backgroundPosition: 'center center',
             }}>
        </div>

        {/* Header */}
        <div className="relative z-10 p-4 flex justify-between items-center border-b border-[#02b36d40]">
          <div className="flex items-center">
            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[#02b36d20] mr-3">
              <DollarSign size={16} className="text-[#02b36d]" />
            </div>
            <h2 className="text-lg font-semibold text-[#e4fbf2] font-mono">
              <span className="text-[#02b36d]">/</span> CUSTOM BUY <span className="text-[#02b36d]">/</span>
            </h2>
          </div>
          <button 
            onClick={onClose}
            className="text-[#7ddfbd] hover:text-[#02b36d] transition-colors p-1 hover:bg-[#02b36d20] rounded"
          >
            <X size={18} />
          </button>
        </div>

        {/* Progress Indicator */}
        <div className="relative w-full h-1 bg-[#091217] progress-bar-cyberpunk">
          <div 
            className="h-full bg-[#02b36d] transition-all duration-300"
            style={{ width: `${(currentStep + 1) / STEPS_CUSTOMBUY.length * 100}%` }}
          ></div>
        </div>

        {/* Content */}
        <div className="relative z-10 p-5 lg:p-6 overflow-y-auto max-h-[80vh]">
          <form
            onSubmit={
              currentStep === STEPS_CUSTOMBUY.length - 1
                ? handleCustomBuy
                : (e) => e.preventDefault()
            }
          >
            {renderStepContent()}
            
            {/* Action Buttons */}
            <div className="flex justify-between mt-8 pt-4 border-t border-[#02b36d40]">
              <button
                type="button"
                onClick={currentStep === 0 ? onClose : handleBack}
                disabled={isSubmitting}
                className="px-5 py-2.5 text-[#e4fbf2] bg-[#091217] border border-[#02b36d30] hover:bg-[#0a1419] hover:border-[#02b36d] rounded-lg transition-all duration-200 shadow-md font-mono tracking-wider modal-btn-cyberpunk"
              >
                {currentStep === 0 ? 'CANCEL' : 'BACK'}
              </button>
              <button
                type={currentStep === STEPS_CUSTOMBUY.length - 1 ? 'submit' : 'button'}
                onClick={currentStep === STEPS_CUSTOMBUY.length - 1 ? undefined : handleNext}
                disabled={
                  isSubmitting ||
                  (currentStep === STEPS_CUSTOMBUY.length - 1 && !isConfirmed)
                }
                className={`px-5 py-2.5 rounded-lg shadow-lg flex items-center transition-all duration-300 font-mono tracking-wider 
                          ${isSubmitting || (currentStep === STEPS_CUSTOMBUY.length - 1 && !isConfirmed)
                            ? 'bg-[#02b36d50] text-[#050a0e80] cursor-not-allowed opacity-50' 
                            : 'bg-[#02b36d] text-[#050a0e] hover:bg-[#01a35f] transform hover:-translate-y-0.5 modal-btn-cyberpunk'}`}
              >
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 rounded-full border-2 border-[#050a0e80] border-t-transparent animate-spin mr-2"></div>
                    PROCESSING...
                  </>
                ) : (
                  <>
                    {currentStep === STEPS_CUSTOMBUY.length - 1 ? 'CONFIRM OPERATION' : (
                      <span className="flex items-center">
                        NEXT
                        <ChevronRight size={16} className="ml-1" />
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
        
        {/* Cyberpunk decorative corner elements */}
        <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[#02b36d] opacity-70"></div>
        <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[#02b36d] opacity-70"></div>
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[#02b36d] opacity-70"></div>
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[#02b36d] opacity-70"></div>
      </div>
    </div>,
    document.body
  );
};