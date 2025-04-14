import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowsUpFromLine, DollarSign, X, CheckCircle, Info, Search, ChevronRight, Settings } from 'lucide-react';
import { Connection } from '@solana/web3.js';
import { useToast } from "./Notifications";
import { WalletType } from './Utils';
import { batchDistributeSOL, validateDistributionInputs } from './utils/distribute';

interface DistributeModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallets: WalletType[];
  solBalances: Map<string, number>;
  connection: Connection;
}

interface WalletAmount {
  address: string;
  amount: string;
}

export const DistributeModal: React.FC<DistributeModalProps> = ({
  isOpen,
  onClose,
  wallets,
  solBalances
}) => {
  // States for the modal
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const { showToast } = useToast();

  // States for distribute operation
  const [selectedRecipientWallets, setSelectedRecipientWallets] = useState<string[]>([]);
  const [selectedSenderWallet, setSelectedSenderWallet] = useState('');
  const [commonAmount, setCommonAmount] = useState('');
  const [useCustomAmounts, setUseCustomAmounts] = useState(false);
  const [walletAmounts, setWalletAmounts] = useState<WalletAmount[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [senderSearchTerm, setSenderSearchTerm] = useState('');
  const [showInfoTip, setShowInfoTip] = useState(false);
  const [sortOption, setSortOption] = useState('address');
  const [sortDirection, setSortDirection] = useState('asc');
  const [balanceFilter, setBalanceFilter] = useState('all');
  
  // Get wallet SOL balance by address
  const getWalletBalance = (address: string) => {
    return solBalances.has(address) ? solBalances.get(address) : 0;
  };

  // Calculate total amount for all recipients
  const calculateTotalAmount = () => {
    if (useCustomAmounts) {
      return walletAmounts.reduce((total, item) => {
        return total + (parseFloat(item.amount) || 0);
      }, 0);
    } else {
      return parseFloat(commonAmount || '0') * selectedRecipientWallets.length;
    }
  };
  
  // Function to highlight recipients with missing amounts
  const hasEmptyAmounts = () => {
    if (!useCustomAmounts) return false;
    
    return walletAmounts.some(wallet => 
      selectedRecipientWallets.includes(wallet.address) && 
      (!wallet.amount || parseFloat(wallet.amount) === 0)
    );
  };

  // Calculate total amount
  const totalAmount = calculateTotalAmount();
  const senderBalance = getWalletBalance(selectedSenderWallet) || 0;
  const hasEnoughBalance = totalAmount <= senderBalance;

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen]);

  // Update walletAmounts when selectedRecipientWallets change
  useEffect(() => {
    updateWalletAmounts();
  }, [selectedRecipientWallets]);

  // Update wallet amounts when toggling between common/custom amounts
  useEffect(() => {
    updateWalletAmounts();
  }, [useCustomAmounts, commonAmount]);

  // Format SOL balance for display
  const formatSolBalance = (balance: number) => {
    return balance.toFixed(4);
  };

  // Get wallet by address
  const getWalletByAddress = (address: string) => {
    return wallets.find(wallet => wallet.address === address);
  };

  // Get wallet private key by address
  const getPrivateKeyByAddress = (address: string) => {
    const wallet = getWalletByAddress(address);
    return wallet ? wallet.privateKey : '';
  };

  // Update wallet amounts based on selected wallets
  const updateWalletAmounts = () => {
    if (useCustomAmounts) {
      // Maintain existing amounts for wallets that remain selected
      const existingAmounts = new Map(walletAmounts.map(w => [w.address, w.amount]));
      
      // Create a new walletAmounts array with currently selected wallets
      const newWalletAmounts = selectedRecipientWallets.map(address => ({
        address,
        amount: existingAmounts.get(address) || commonAmount || ''
      }));
      
      setWalletAmounts(newWalletAmounts);
    } else {
      // When using common amount, just create entries with the common amount
      const newWalletAmounts = selectedRecipientWallets.map(address => ({
        address,
        amount: commonAmount
      }));
      
      setWalletAmounts(newWalletAmounts);
    }
  };

  // Reset form state
  const resetForm = () => {
    setCurrentStep(0);
    setIsConfirmed(false);
    setSelectedRecipientWallets([]);
    setSelectedSenderWallet('');
    setCommonAmount('');
    setUseCustomAmounts(false);
    setWalletAmounts([]);
    setSearchTerm('');
    setSenderSearchTerm('');
    setSortOption('address');
    setSortDirection('asc');
    setBalanceFilter('all');
  };

  // Handle wallet amount change
  const handleWalletAmountChange = (address: string, value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setWalletAmounts(prev => 
        prev.map(wallet => 
          wallet.address === address 
            ? { ...wallet, amount: value } 
            : wallet
        )
      );
    }
  };

  // Handle distribute operation
  const handleDistribute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmed) return;

    setIsSubmitting(true);
    
    try {
      // Get sender private key
      const senderPrivateKey = getPrivateKeyByAddress(selectedSenderWallet);
      if (!senderPrivateKey) {
        showToast("Sender wallet private key not found", "error");
        setIsSubmitting(false);
        return;
      }

      // Prepare sender and recipient wallet data
      const senderWallet = {
        address: selectedSenderWallet,
        privateKey: senderPrivateKey,
        amount: '0' // Not used for sender
      };

      // Prepare recipient wallets with their private keys and amounts
      const recipientWallets = walletAmounts
        .filter(wallet => selectedRecipientWallets.includes(wallet.address))
        .map(wallet => ({
          address: wallet.address,
          privateKey: getPrivateKeyByAddress(wallet.address),
          amount: wallet.amount
        }))
        .filter(wallet => wallet.privateKey && wallet.amount);

      // Validate all inputs
      const validation = validateDistributionInputs(
        senderWallet,
        recipientWallets,
        senderBalance
      );

      if (!validation.valid) {
        showToast(validation.error || "Invalid distribution data", "error");
        setIsSubmitting(false);
        return;
      }

      // Execute the distribution
      const result = await batchDistributeSOL(senderWallet, recipientWallets);
      
      if (result.success) {
        showToast("SOL distributed successfully", "success");
        resetForm();
        onClose();
      } else {
        showToast(result.error || "Distribution failed", "error");
      }
    } catch (error) {
      console.error('Distribution error:', error);
      showToast("Distribution failed: " + (error.message || "Unknown error"), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Function to handle recipient wallet selection toggles for distribute
  const toggleRecipientWalletSelection = (address: string) => {
    setSelectedRecipientWallets(prev => {
      if (prev.includes(address)) {
        return prev.filter(a => a !== address);
      } else {
        return [...prev, address];
      }
    });
  };

  // Get available wallets for distribute recipient selection (exclude sender)
  const getAvailableRecipientWallets = () => {
    return wallets.filter(wallet => wallet.address !== selectedSenderWallet);
  };

  // Get available wallets for sender selection in distribute (exclude recipients and zero balance wallets)
  const getAvailableSenderWallets = () => {
    return wallets.filter(wallet => 
      !selectedRecipientWallets.includes(wallet.address) && 
      (getWalletBalance(wallet.address) || 0) > 0
    );
  };
  
  // Handle select/deselect all for recipient wallets
  const handleSelectAllRecipients = () => {
    if (selectedRecipientWallets.length === getAvailableRecipientWallets().length) {
      setSelectedRecipientWallets([]);
    } else {
      setSelectedRecipientWallets(getAvailableRecipientWallets().map(wallet => wallet.address));
    }
  };

  // Apply common amount to all selected wallets
  const applyCommonAmountToAll = () => {
    setWalletAmounts(prev => 
      prev.map(wallet => ({ ...wallet, amount: commonAmount }))
    );
  };

  // Filter and sort wallets based on search term and other criteria
  const filterWallets = (walletList: WalletType[], search: string) => {
    // First apply search filter
    let filtered = walletList;
    if (search) {
      filtered = filtered.filter(wallet => 
        wallet.address.toLowerCase().includes(search.toLowerCase())
      );
    }
    
    // Then apply balance filter
    if (balanceFilter !== 'all') {
      if (balanceFilter === 'nonZero') {
        filtered = filtered.filter(wallet => (getWalletBalance(wallet.address) || 0) > 0);
      } else if (balanceFilter === 'highBalance') {
        filtered = filtered.filter(wallet => (getWalletBalance(wallet.address) || 0) >= 0.1);
      } else if (balanceFilter === 'lowBalance') {
        filtered = filtered.filter(wallet => (getWalletBalance(wallet.address) || 0) < 0.1 && (getWalletBalance(wallet.address) || 0) > 0);
      }
    }
    
    // Finally, sort the wallets
    return filtered.sort((a, b) => {
      if (sortOption === 'address') {
        return sortDirection === 'asc' 
          ? a.address.localeCompare(b.address)
          : b.address.localeCompare(a.address);
      } else if (sortOption === 'balance') {
        const balanceA = getWalletBalance(a.address) || 0;
        const balanceB = getWalletBalance(b.address) || 0;
        return sortDirection === 'asc' ? balanceA - balanceB : balanceB - balanceA;
      }
      return 0;
    });
  };

  // Format wallet address for display
  const formatAddress = (address: string) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  // Get wallet amount by address
  const getWalletAmount = (address: string) => {
    const wallet = walletAmounts.find(w => w.address === address);
    return wallet ? wallet.amount : '';
  };

  // If modal is not open, don't render anything
  if (!isOpen) return null;

  // Animation keyframes for cyberpunk elements
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

    /* Responsive styles */
    @media (max-width: 1024px) {
      .modal-flex-col-lg {
        flex-direction: column;
      }
      .modal-w-full-lg {
        width: 100%;
      }
      .modal-mt-4-lg {
        margin-top: 1rem;
      }
    }
    
    @media (max-width: 768px) {
      .modal-flex-col-md {
        flex-direction: column;
      }
      .modal-w-full-md {
        width: 100%;
      }
      .modal-mt-4-md {
        margin-top: 1rem;
      }
    }
    
    @media (max-width: 640px) {
      .modal-text-xs-sm {
        font-size: 0.75rem;
      }
      .modal-p-3-sm {
        padding: 0.75rem;
      }
      .modal-mx-1-sm {
        margin-left: 0.25rem;
        margin-right: 0.25rem;
      }
    }
  `;
  document.head.appendChild(modalStyleElement);

  // Render the modal with cyberpunk styling
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm modal-cyberpunk-container" style={{backgroundColor: 'rgba(5, 10, 14, 0.85)'}}>
      <div className="relative bg-[#050a0e] border border-[#02b36d40] rounded-lg shadow-lg w-full max-w-6xl overflow-hidden transform modal-cyberpunk-content modal-glow">
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
              <ArrowsUpFromLine size={16} className="text-[#02b36d]" />
            </div>
            <h2 className="text-lg font-semibold text-[#e4fbf2] font-mono">
              <span className="text-[#02b36d]">/</span> DISTRIBUTE SOL <span className="text-[#02b36d]">/</span>
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
            style={{ width: currentStep === 0 ? '50%' : '100%' }}
          ></div>
        </div>

        {/* Content */}
        <div className="relative z-10 p-4 space-y-4">
          {currentStep === 0 && (
            <div className="animate-[fadeIn_0.3s_ease]">
              {/* Horizontal Layout of Wallets */}
              <div className="flex space-x-4 modal-flex-col-lg">
                {/* Left Side - Sender Wallet Selector */}
                <div className="w-1/2 modal-w-full-lg">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-[#7ddfbd] font-mono uppercase tracking-wider">
                      <span className="text-[#02b36d]">&#62;</span> From Wallet <span className="text-[#02b36d]">&#60;</span>
                    </label>
                    {selectedSenderWallet && (
                      <div className="flex items-center gap-1 text-xs">
                        <DollarSign size={10} className="text-[#7ddfbd]" />
                        <span className="text-[#02b36d] font-medium font-mono">
                          {formatSolBalance(senderBalance)} SOL
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Sender Search and Filters */}
                  <div className="mb-2 flex space-x-2">
                    <div className="relative flex-grow">
                      <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#7ddfbd]" />
                      <input
                        type="text"
                        value={senderSearchTerm}
                        onChange={(e) => setSenderSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-[#091217] border border-[#02b36d30] rounded-lg text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] transition-all modal-input-cyberpunk font-mono"
                        placeholder="SEARCH SENDER WALLETS..."
                      />
                    </div>
                    
                    <select 
                      className="bg-[#091217] border border-[#02b36d30] rounded-lg px-2 text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] modal-input-cyberpunk font-mono"
                      value={sortOption}
                      onChange={(e) => setSortOption(e.target.value)}
                    >
                      <option value="address">ADDRESS</option>
                      <option value="balance">BALANCE</option>
                    </select>
                    
                    <button
                      className="p-2 bg-[#091217] border border-[#02b36d30] rounded-lg text-[#7ddfbd] hover:text-[#02b36d] hover:border-[#02b36d] transition-all modal-btn-cyberpunk"
                      onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                    >
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </button>
                  </div>

                  <div className="max-h-48 overflow-y-auto border border-[#02b36d20] rounded-lg shadow-inner bg-[#091217] transition-all duration-200 hover:border-[#02b36d40] scrollbar-thin">
                    {filterWallets(getAvailableSenderWallets(), senderSearchTerm).length > 0 ? (
                      filterWallets(getAvailableSenderWallets(), senderSearchTerm).map((wallet) => (
                        <div 
                          key={wallet.id}
                          className={`flex items-center p-2.5 hover:bg-[#0a1419] cursor-pointer transition-all duration-200 border-b border-[#02b36d20] last:border-b-0
                                    ${selectedSenderWallet === wallet.address ? 'bg-[#02b36d10] border-[#02b36d30]' : ''}`}
                          onClick={() => setSelectedSenderWallet(wallet.address)}
                        >
                          <div className={`w-5 h-5 mr-3 rounded flex items-center justify-center transition-all duration-300
                                          ${selectedSenderWallet === wallet.address
                                            ? 'bg-[#02b36d] shadow-md shadow-[#02b36d40]' 
                                            : 'border border-[#02b36d30] bg-[#091217]'}`}>
                            {selectedSenderWallet === wallet.address && (
                              <CheckCircle size={14} className="text-[#050a0e] animate-[fadeIn_0.2s_ease]" />
                            )}
                          </div>
                          <div className="flex-1 flex justify-between items-center">
                            <span className="font-mono text-sm text-[#e4fbf2] glitch-text">{formatAddress(wallet.address)}</span>
                            <span className="text-xs text-[#7ddfbd] font-mono">{formatSolBalance(getWalletBalance(wallet.address) || 0)} SOL</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 text-sm text-[#7ddfbd] text-center font-mono">
                        {senderSearchTerm ? "NO WALLETS FOUND" : "NO WALLETS AVAILABLE"}
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Right Side - Recipient Wallets */}
                <div className="w-1/2 modal-w-full-lg modal-mt-4-lg">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-[#7ddfbd] font-mono uppercase tracking-wider">
                      <span className="text-[#02b36d]">&#62;</span> To Wallets <span className="text-[#02b36d]">&#60;</span>
                    </label>
                    <button 
                      onClick={handleSelectAllRecipients}
                      className="text-xs px-2 py-0.5 bg-[#091217] hover:bg-[#0a1419] text-[#7ddfbd] hover:text-[#02b36d] rounded border border-[#02b36d30] hover:border-[#02b36d] transition-all duration-200 font-mono"
                    >
                      {selectedRecipientWallets.length === getAvailableRecipientWallets().length ? 'DESELECT ALL' : 'SELECT ALL'}
                    </button>
                  </div>

                  {/* Recipient Search and Filters */}
                  <div className="mb-2 flex space-x-2">
                    <div className="relative flex-grow">
                      <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#7ddfbd]" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-[#091217] border border-[#02b36d30] rounded-lg text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] transition-all modal-input-cyberpunk font-mono"
                        placeholder="SEARCH RECIPIENT WALLETS..."
                      />
                    </div>
                    
                    <select 
                      className="bg-[#091217] border border-[#02b36d30] rounded-lg px-2 text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] modal-input-cyberpunk font-mono"
                      value={balanceFilter}
                      onChange={(e) => setBalanceFilter(e.target.value)}
                    >
                      <option value="all">ALL</option>
                      <option value="nonZero">NON-ZERO</option>
                      <option value="highBalance">HIGH BAL</option>
                      <option value="lowBalance">LOW BAL</option>
                    </select>
                  </div>

                  <div className="max-h-48 overflow-y-auto border border-[#02b36d20] rounded-lg shadow-inner bg-[#091217] transition-all duration-200 hover:border-[#02b36d40] scrollbar-thin">
                    {filterWallets(getAvailableRecipientWallets(), searchTerm).length > 0 ? (
                      filterWallets(getAvailableRecipientWallets(), searchTerm).map((wallet) => (
                        <div 
                          key={wallet.id}
                          className={`flex items-center p-2.5 hover:bg-[#0a1419] transition-all duration-200 border-b border-[#02b36d20] last:border-b-0
                                    ${selectedRecipientWallets.includes(wallet.address) ? 'bg-[#02b36d10] border-[#02b36d30]' : ''}`}
                        >
                          <div 
                            className={`w-5 h-5 mr-3 rounded flex items-center justify-center transition-all duration-300 cursor-pointer
                                        ${selectedRecipientWallets.includes(wallet.address) 
                                          ? 'bg-[#02b36d] shadow-md shadow-[#02b36d40]' 
                                          : 'border border-[#02b36d30] bg-[#091217]'}`}
                            onClick={() => toggleRecipientWalletSelection(wallet.address)}
                          >
                            {selectedRecipientWallets.includes(wallet.address) && (
                              <CheckCircle size={14} className="text-[#050a0e] animate-[fadeIn_0.2s_ease]" />
                            )}
                          </div>
                          <div className="flex-1 flex justify-between items-center">
                            <span 
                              className="font-mono text-sm text-[#e4fbf2] cursor-pointer glitch-text"
                              onClick={() => toggleRecipientWalletSelection(wallet.address)}
                            >
                              {formatAddress(wallet.address)}
                            </span>
                            
                            {useCustomAmounts && selectedRecipientWallets.includes(wallet.address) ? (
                              <div className="relative w-24 ml-2">
                                <DollarSign size={12} className="absolute left-2 top-1/2 transform -translate-y-1/2 text-[#7ddfbd]" />
                                <input
                                  type="text"
                                  value={getWalletAmount(wallet.address)}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    const value = e.target.value;
                                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                      handleWalletAmountChange(wallet.address, value);
                                    }
                                  }}
                                  className="w-full pl-6 pr-2 py-1 bg-[#0a1419] border border-[#02b36d30] rounded text-xs text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] modal-input-cyberpunk font-mono"
                                  placeholder="0.00"
                                />
                              </div>
                            ) : (
                              <span className="text-xs text-[#7ddfbd] font-mono">{formatSolBalance(getWalletBalance(wallet.address) || 0)} SOL</span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 text-sm text-[#7ddfbd] text-center font-mono">
                        {searchTerm ? "NO WALLETS FOUND" : "NO WALLETS AVAILABLE"}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-[#7ddfbd] font-mono">
                      SELECTED: <span className="text-[#02b36d] font-medium">{selectedRecipientWallets.length}</span> WALLETS
                    </span>
                    {selectedRecipientWallets.length > 0 && commonAmount && !useCustomAmounts && (
                      <span className="text-[#7ddfbd] font-mono">
                        EACH RECEIVES: <span className="text-[#02b36d] font-medium">{commonAmount} SOL</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Amount Input and Preview Section */}
              <div className="w-full mx-auto mt-6">
                {/* Toggle between common and custom amounts */}
                <div className="flex items-center justify-between mb-2 max-w-md mx-auto">
                  <div className="flex items-center gap-1">
                    <Settings size={14} className="text-[#7ddfbd]" />
                    <span className="text-sm font-medium text-[#7ddfbd] font-mono uppercase tracking-wider">Amount Settings</span>
                  </div>
                  <div className="flex items-center">
                    <span className="text-xs text-[#7ddfbd] mr-2 font-mono">CUSTOM AMOUNT PER WALLET</span>
                    <div 
                      onClick={() => setUseCustomAmounts(!useCustomAmounts)}
                      className={`w-10 h-5 rounded-full cursor-pointer transition-all duration-200 flex items-center ${useCustomAmounts ? 'bg-[#02b36d]' : 'bg-[#091217] border border-[#02b36d30]'}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-[#e4fbf2] transform transition-all duration-200 ${useCustomAmounts ? 'translate-x-5' : 'translate-x-1'}`}></div>
                    </div>
                  </div>
                </div>

                {/* Common amount input and summary - shown when not using custom amounts */}
                {!useCustomAmounts && (
                  <div className="flex items-start space-x-4 modal-flex-col-md">
                    <div className="w-1/2 modal-w-full-md">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1">
                          <label className="text-sm font-medium text-[#7ddfbd] font-mono uppercase tracking-wider">
                            <span className="text-[#02b36d]">&#62;</span> Amount per Wallet <span className="text-[#02b36d]">&#60;</span>
                          </label>
                          <div className="relative" onMouseEnter={() => setShowInfoTip(true)} onMouseLeave={() => setShowInfoTip(false)}>
                            <Info size={14} className="text-[#7ddfbd] cursor-help" />
                            {showInfoTip && (
                              <div className="absolute left-0 bottom-full mb-2 p-2 bg-[#091217] border border-[#02b36d30] rounded shadow-lg text-xs text-[#e4fbf2] w-48 z-10 font-mono">
                                This amount will be sent to each selected recipient wallet
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="relative">
                        <DollarSign size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#7ddfbd]" />
                        <input
                          type="text"
                          value={commonAmount}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                              setCommonAmount(value);
                            }
                          }}
                          className={`w-full pl-9 pr-4 py-2.5 bg-[#091217] border rounded-lg text-[#e4fbf2] focus:outline-none transition-all duration-200 modal-input-cyberpunk font-mono
                                    ${hasEnoughBalance ? 'border-[#02b36d30] focus:border-[#02b36d]' : 'border-[#ff4d4f]'}`}
                          placeholder="0.001"
                        />
                      </div>
                    </div>
                    
                    {/* Real-time preview - in the same row */}
                    {selectedSenderWallet && commonAmount && selectedRecipientWallets.length > 0 && (
                      <div className="w-1/2 bg-[#091217] rounded-lg p-3 border border-[#02b36d30] modal-w-full-md modal-mt-4-md">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-[#7ddfbd] font-mono">TOTAL TO SEND:</span>
                          <span className={`text-sm font-semibold font-mono ${hasEnoughBalance ? 'text-[#02b36d]' : 'text-[#ff4d4f]'}`}>
                            {totalAmount.toFixed(4)} SOL
                          </span>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-sm text-[#7ddfbd] font-mono">REMAINING BALANCE:</span>
                          <span className="text-sm text-[#e4fbf2] font-mono">{(senderBalance - totalAmount).toFixed(4)} SOL</span>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-sm text-[#7ddfbd] font-mono">EACH WALLET RECEIVES:</span>
                          <span className="text-sm text-[#02b36d] font-mono">{commonAmount} SOL</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Custom amounts "Apply to All" control */}
                {useCustomAmounts && selectedRecipientWallets.length > 0 && (
                  <div className="flex items-start space-x-4 mt-2 modal-flex-col-md">
                    <div className="flex-grow modal-w-full-md">
                      {/* Quick set common amount control */}
                      <div className="flex items-center gap-2 mb-2">
                        <div className="relative flex-grow">
                          <DollarSign size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#7ddfbd]" />
                          <input
                            type="text"
                            value={commonAmount}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                setCommonAmount(value);
                              }
                            }}
                            className="w-full pl-9 pr-4 py-2 bg-[#091217] border border-[#02b36d30] rounded-lg text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] transition-all modal-input-cyberpunk font-mono"
                            placeholder="SET COMMON AMOUNT"
                          />
                        </div>
                        <button
                          onClick={applyCommonAmountToAll}
                          disabled={!commonAmount}
                          className={`whitespace-nowrap px-3 py-2 text-sm rounded-lg transition-all font-mono border
                                    ${!commonAmount 
                                      ? 'bg-[#091217] text-[#7ddfbd60] border-[#02b36d20] cursor-not-allowed' 
                                      : 'bg-[#091217] hover:bg-[#0a1419] text-[#e4fbf2] border-[#02b36d30] hover:border-[#02b36d] modal-btn-cyberpunk'}`}
                        >
                          APPLY TO ALL
                        </button>
                      </div>
                    </div>
                    
                    {/* Real-time preview for custom amounts */}
                    {selectedSenderWallet && totalAmount > 0 && (
                      <div className="w-2/5 bg-[#091217] rounded-lg p-3 border border-[#02b36d30] modal-w-full-md modal-mt-4-md">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-[#7ddfbd] font-mono">TOTAL TO SEND:</span>
                          <span className={`text-sm font-semibold font-mono ${hasEnoughBalance ? 'text-[#02b36d]' : 'text-[#ff4d4f]'}`}>
                            {totalAmount.toFixed(4)} SOL
                          </span>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-sm text-[#7ddfbd] font-mono">REMAINING BALANCE:</span>
                          <span className="text-sm text-[#e4fbf2] font-mono">{(senderBalance - totalAmount).toFixed(4)} SOL</span>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-sm text-[#7ddfbd] font-mono">RECIPIENTS:</span>
                          <span className="text-sm text-[#e4fbf2] font-mono">{selectedRecipientWallets.length} WALLETS</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {/* Next/Cancel Buttons */}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 text-[#e4fbf2] bg-[#091217] border border-[#02b36d30] hover:bg-[#0a1419] hover:border-[#02b36d] rounded-lg transition-all duration-200 shadow-md font-mono tracking-wider modal-btn-cyberpunk"
                >
                  CANCEL
                </button>
                <button
                  onClick={() => setCurrentStep(1)}
                  disabled={
                    !selectedSenderWallet || 
                    selectedRecipientWallets.length === 0 || 
                    !hasEnoughBalance ||
                    (useCustomAmounts && (totalAmount === 0 || hasEmptyAmounts())) ||
                    (!useCustomAmounts && !commonAmount)
                  }
                  className={`px-5 py-2.5 rounded-lg shadow-lg flex items-center transition-all duration-300 font-mono tracking-wider text-[#050a0e]
                            ${!selectedSenderWallet || 
                              selectedRecipientWallets.length === 0 || 
                              !hasEnoughBalance ||
                              (useCustomAmounts && (totalAmount === 0 || hasEmptyAmounts())) ||
                              (!useCustomAmounts && !commonAmount)
                              ? 'bg-[#02b36d50] cursor-not-allowed opacity-50' 
                              : 'bg-[#02b36d] hover:bg-[#01a35f] transform hover:-translate-y-0.5 modal-btn-cyberpunk'}`}
                >
                  {hasEmptyAmounts() && (
                    <span className="text-xs mr-2 bg-[#ff4d4f20] text-[#ff4d4f] px-2 py-0.5 rounded font-mono">MISSING AMOUNTS</span>
                  )}
                  <span>REVIEW</span>
                  <ChevronRight size={16} className="ml-1" />
                </button>
              </div>
            </div>
          )}
          
          {currentStep === 1 && (
            <div className="flex space-x-4 modal-flex-col-lg animate-[fadeIn_0.3s_ease]">
              {/* Left Side - Summary */}
              <div className="w-1/2 space-y-4 modal-w-full-lg">
                <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d30]">
                  <h3 className="text-base font-semibold text-[#e4fbf2] mb-3 font-mono tracking-wider">DISTRIBUTION SUMMARY</h3>
                  
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#7ddfbd] font-mono">FROM WALLET:</span>
                      <div className="flex items-center bg-[#0a1419] px-2 py-1 rounded border border-[#02b36d20]">
                        <span className="text-sm font-mono text-[#e4fbf2] glitch-text">{formatAddress(selectedSenderWallet)}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#7ddfbd] font-mono">WALLET BALANCE:</span>
                      <span className="text-sm text-[#e4fbf2] font-mono">{formatSolBalance(senderBalance)} SOL</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#7ddfbd] font-mono">RECIPIENTS:</span>
                      <span className="text-sm text-[#e4fbf2] font-mono">{selectedRecipientWallets.length} WALLETS</span>
                    </div>
                    
                    {!useCustomAmounts && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-[#7ddfbd] font-mono">AMOUNT PER WALLET:</span>
                        <span className="text-sm text-[#02b36d] font-medium font-mono">{commonAmount} SOL</span>
                      </div>
                    )}
                    
                    {useCustomAmounts && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-[#7ddfbd] font-mono">CUSTOM AMOUNTS:</span>
                        <span className="text-sm text-[#02b36d] font-medium font-mono">YES</span>
                      </div>
                    )}
                    
                    <div className="pt-2 border-t border-[#02b36d20] flex items-center justify-between">
                      <span className="text-sm font-medium text-[#7ddfbd] font-mono">TOTAL TO SEND:</span>
                      <span className="text-sm font-semibold text-[#02b36d] font-mono">{totalAmount.toFixed(4)} SOL</span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#7ddfbd] font-mono">REMAINING BALANCE:</span>
                      <span className="text-sm text-[#e4fbf2] font-mono">{(senderBalance - totalAmount).toFixed(4)} SOL</span>
                    </div>
                  </div>
                </div>
                
                {/* Confirmation Checkbox */}
                <div className="flex items-center px-3 py-3 bg-[#091217] rounded-lg border border-[#02b36d30]">
                  <div className="relative mx-1">
                    <input
                      type="checkbox"
                      id="confirmDistribute"
                      checked={isConfirmed}
                      onChange={(e) => setIsConfirmed(e.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="w-5 h-5 border border-[#02b36d40] rounded peer-checked:bg-[#02b36d] peer-checked:border-0 transition-all"></div>
                    <CheckCircle size={14} className={`absolute top-0.5 left-0.5 text-[#050a0e] transition-all ${isConfirmed ? 'opacity-100' : 'opacity-0'}`} />
                  </div>
                  <label htmlFor="confirmDistribute" className="text-[#e4fbf2] text-sm ml-2 cursor-pointer select-none font-mono">
                    I CONFIRM THIS DISTRIBUTION OPERATION
                  </label>
                </div>
              </div>
              
              {/* Right Side - Recipients List */}
              <div className="w-1/2 modal-w-full-lg modal-mt-4-lg">
                <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d30] h-full">
                  <h3 className="text-base font-semibold text-[#e4fbf2] mb-3 font-mono tracking-wider">SELECTED RECIPIENTS</h3>
                  
                  <div className="max-h-64 overflow-y-auto pr-1 scrollbar-thin">
                    {selectedRecipientWallets.length > 0 ? (
                      selectedRecipientWallets.map((address, index) => {
                        const wallet = getWalletByAddress(address);
                        const amount = useCustomAmounts ? getWalletAmount(address) : commonAmount;
                        
                        return wallet ? (
                          <div key={wallet.id} className="flex items-center justify-between py-1.5 border-b border-[#02b36d20] last:border-b-0">
                            <div className="flex items-center">
                              <span className="text-[#7ddfbd] text-xs mr-2 w-6 font-mono">{index + 1}.</span>
                              <span className="font-mono text-sm text-[#e4fbf2] glitch-text">{formatAddress(wallet.address)}</span>
                            </div>
                            <div className="flex items-center">
                              <span className="text-xs text-[#7ddfbd] mr-2 font-mono">CURRENT: {formatSolBalance(getWalletBalance(wallet.address) || 0)} SOL</span>
                              <span className="text-xs text-[#02b36d] font-mono">+{amount} SOL</span>
                            </div>
                          </div>
                        ) : null;
                      })
                    ) : (
                      <div className="p-3 text-sm text-[#7ddfbd] text-center font-mono">
                        NO RECIPIENTS SELECTED
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Back/Distribute Buttons */}
          {currentStep === 1 && (
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setCurrentStep(0)}
                className="px-5 py-2.5 text-[#e4fbf2] bg-[#091217] border border-[#02b36d30] hover:bg-[#0a1419] hover:border-[#02b36d] rounded-lg transition-all duration-200 shadow-md font-mono tracking-wider modal-btn-cyberpunk"
              >
                BACK
              </button>
              <button
                onClick={handleDistribute}
                disabled={!isConfirmed || isSubmitting}
                className={`px-5 py-2.5 text-[#050a0e] rounded-lg shadow-lg flex items-center transition-all duration-300 font-mono tracking-wider 
                          ${!isConfirmed || isSubmitting
                            ? 'bg-[#02b36d50] cursor-not-allowed opacity-50' 
                            : 'bg-[#02b36d] hover:bg-[#01a35f] transform hover:-translate-y-0.5 modal-btn-cyberpunk'}`}
              >
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 rounded-full border-2 border-[#050a0e80] border-t-transparent animate-spin mr-2"></div>
                    PROCESSING...
                  </>
                ) : (
                  "DISTRIBUTE SOL"
                )}
              </button>
            </div>
          )}
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