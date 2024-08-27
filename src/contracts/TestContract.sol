// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "hardhat/console.sol";

contract TestContract is ERC721URIStorage, Ownable {
    bytes32 public freeMerkleRoot;
    bytes32 public paidMerkleRoot;
    uint256 public mintingState = 0;
    uint256 public whitelistMintPrice = 0.02 ether;
    uint256 public mintPrice = 0.03 ether;
    string private baseTokenURI;
    bool public mintingIsActive = false;
    mapping(address => bool) public hasMintedFree;
    uint256 private _tokenIdCounter = 0;

    constructor(string memory name, string memory symbol) Ownable(msg.sender) ERC721(name, symbol) {}

    function setMintingState(uint256 _state) external onlyOwner {
        mintingState = _state;
    }

    function setFreeMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
        freeMerkleRoot = _merkleRoot;
    }

    function setPaidMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
        paidMerkleRoot = _merkleRoot;
    }

    function setWhitelistMintPrice(uint256 _price) external onlyOwner {
        whitelistMintPrice = _price;
    }

    function setMintPrice(uint256 _price) external onlyOwner {
        mintPrice = _price;
    }

    function setBaseURI(string memory baseURI) external onlyOwner {
        baseTokenURI = baseURI;
    }

    function toggleMintingIsActive() external onlyOwner {
        mintingIsActive = !mintingIsActive;
    }

    function mint(uint256 amount, bytes32[] calldata merkleProof) external payable {
        require(mintingIsActive, "Minting is not active");
        require(amount > 0, "Must mint at least one token");

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender));

        if (mintingState == 0) {
            require(amount == 1, "Can only mint 1 token in Stage 0");
            require(!hasMintedFree[msg.sender], "Already minted in Stage 0");
            require(MerkleProof.verify(merkleProof, freeMerkleRoot, leaf), "Invalid proof for free minting");
            hasMintedFree[msg.sender] = true;
        } else if (mintingState == 1) {
            require(MerkleProof.verify(merkleProof, paidMerkleRoot, leaf), "Invalid proof for paid minting");
            require(msg.value >= whitelistMintPrice * amount, "Insufficient funds for paid minting");
        } else if (mintingState == 2) {
            require(msg.value >= mintPrice * amount, "Insufficient funds for public minting");
        } else {
            revert("Invalid minting state");
        }

        for (uint256 i = 0; i < amount; i++) {
            uint256 tokenId = totalSupply() + 1;
            _mint(msg.sender, tokenId);
            _tokenIdCounter++;
        }
    }

    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        payable(owner()).transfer(balance); // add treasury wallet
    }

    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @dev See {IERC721Metadata-tokenURI}.
     */
    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "ERC721Metadata: URI query for nonexistent token");

        string memory base = _baseURI();

        // Concatenate baseURI + tokenId + ".json"
        return string(abi.encodePacked(base, Strings.toString(tokenId), ".json"));
    }

    /**
     * @dev Base URI for computing {tokenURI}. If set, the resulting URI for each
     * token will be the concatenation of the `baseURI` and the `tokenId`. Empty
     * by default, can be overridden in child contracts.
     */
    function _baseURI() internal view virtual override returns (string memory) {
        return baseTokenURI;
    }
}
