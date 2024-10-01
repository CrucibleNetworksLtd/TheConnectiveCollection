// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "hardhat/console.sol";

contract TestContract is ERC721URIStorage, ERC2981, Ownable {
    address public treasuryWallet;
    bytes32 public freeMerkleRoot;
    bytes32 public discountMerkleRoot;

    enum MintingPhase {
        FreeMint,
        DiscountMint,
        PublicMint
    }
    MintingPhase public mintingPhase = MintingPhase.FreeMint;

    uint256 public discountMintPrice = 0.02 ether;
    uint256 public mintPrice = 0.03 ether;
    uint16 internal _maxSupply = 2500;
    string private baseTokenURI;
    bool public mintingIsActive = false;
    mapping(address => bool) public hasMintedFree;
    mapping(address => bool) public hasMintedDiscount;

    uint256 internal _tokenIdCounter = 0;
    uint16 internal _freeMintingCounter = 0;
    uint16 internal _discountMintingCounter = 0;

    constructor(string memory name, string memory symbol) Ownable(msg.sender) ERC721(name, symbol) {}

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC721URIStorage, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function setDefaultRoyalties(address receiver, uint96 feeNumerator) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function setTreasuryWallet(address _treasuryWallet) external onlyOwner {
        require(_treasuryWallet != address(0), "Invalid treasury address.");
        treasuryWallet = _treasuryWallet;
    }

    function advanceMintingPhase() external onlyOwner {
        require(mintingPhase != MintingPhase.PublicMint, "Already at final minting phase");
        mintingPhase = MintingPhase(uint8(mintingPhase) + 1);
    }

    function setFreeMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
        freeMerkleRoot = _merkleRoot;
    }

    function setDiscountMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
        discountMerkleRoot = _merkleRoot;
    }

    function setBaseURI(string memory baseURI) external onlyOwner {
        require(bytes(baseURI).length > 0, "Base URI cannot be empty.");
        baseTokenURI = baseURI;
    }

    function toggleMintingIsActive() external onlyOwner {
        mintingIsActive = !mintingIsActive;
    }

    function mint(uint16 amount, bytes32[] calldata merkleProof) external payable {
        require(mintingIsActive, "Minting is not active");
        require(amount > 0, "Must mint at least one token");
        require(_tokenIdCounter + amount <= _maxSupply, "Minting amount exceeds maximum supply.");

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender));

        if (mintingPhase == MintingPhase.FreeMint) {
            require(amount == 1, "Can only mint 1 token in Phase 0");
            require(_freeMintingCounter < 1000, "Minting amount exceeds free minting limit.");
            require(!hasMintedFree[msg.sender], "Already minted in Phase 0");
            require(MerkleProof.verify(merkleProof, freeMerkleRoot, leaf), "Invalid proof for free minting");
            require(msg.value == 0, "Incorrect funds for free minting");
            hasMintedFree[msg.sender] = true;
            _freeMintingCounter++;
        } else if (mintingPhase == MintingPhase.DiscountMint) {
            require(MerkleProof.verify(merkleProof, discountMerkleRoot, leaf), "Invalid proof for discount minting");
            require(amount == 1, "Can only mint 1 token in Phase 1");
            require(!hasMintedDiscount[msg.sender], "Already minted in Phase 1");
            require(_discountMintingCounter + amount <= 750, "Minting amount exceeds discount limit.");
            require(msg.value == discountMintPrice * amount, "Incorrect funds for discount minting");
            hasMintedDiscount[msg.sender] = true;
            _discountMintingCounter += amount;
        } else if (mintingPhase == MintingPhase.PublicMint) {
            require(msg.value == mintPrice * amount, "Incorrect funds for public minting");
        }

        for (uint16 i = 0; i < amount; ) {
            _tokenIdCounter++;
            _safeMint(msg.sender, _tokenIdCounter);
            i++;
        }
    }

    function ownerMint(uint16 amount) external onlyOwner {
        require(amount > 0, "Must mint at least one token");
        require(mintingPhase == MintingPhase.PublicMint, "Owner minting is only available in Phase 2");
        require(_tokenIdCounter + amount <= _maxSupply, "Minting amount exceeds maximum supply.");

        for (uint16 i = 0; i < amount; ) {
            _tokenIdCounter++;
            _mint(msg.sender, _tokenIdCounter);
            i++;
        }
    }

    function withdraw() external onlyOwner {
        require(treasuryWallet != address(0), "Treasury not set.");
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");

        (bool success, ) = treasuryWallet.call{value: balance}("");
        require(success, "Transfer failed.");
    }

    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter;
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        require(ownerOf(tokenId) != address(0), "ERC721Metadata: URI query for nonexistent token");
        string memory base = _baseURI();
        return string(abi.encodePacked(base, Strings.toString(tokenId), ".json"));
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return baseTokenURI;
    }
}
