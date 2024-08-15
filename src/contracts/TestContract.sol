// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract TestContract is ERC721URIStorage, Ownable {
    bytes32 public freeMerkleRoot;
    bytes32 public paidMerkleRoot;
    uint256 public mintingState = 0;
    uint256 public mintPrice = 0.1 ether; // Set the mint price for paid minting
    string private baseTokenURI;
    bool public mintingIsActive = false;
    mapping(address => bool) public hasMintedFree;
    uint256 private _tokenIdCounter = 0;

    constructor(string memory name, string memory symbol) ERC721(name, symbol) {}

    function setMintingState(uint256 _state) external onlyOwner {
        mintingState = _state;
    }

    function setFreeMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
        freeMerkleRoot = _merkleRoot;
    }

    function setPaidMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
        paidMerkleRoot = _merkleRoot;
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

    function mint(bytes32[] calldata merkleProof) external payable {
        require(mintingIsActive, "Minting is not active");

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender));

        if (mintingState == 0) {
            require(!hasMintedFree[msg.sender], "Already minted");
            require(MerkleProof.verify(merkleProof, freeMerkleRoot, leaf), "Invalid proof for free minting");
            hasMintedFree[msg.sender] = true;
        } else if (mintingState == 1) {
            require(MerkleProof.verify(merkleProof, paidMerkleRoot, leaf), "Invalid proof for paid minting");
            require(msg.value >= mintPrice, "Insufficient funds for paid minting");
        } else if (mintingState == 2) {
            require(msg.value >= mintPrice, "Insufficient funds for public minting");
        } else {
            revert("Invalid minting state");
        }

        uint256 tokenId = totalSupply() + 1;
        _mint(msg.sender, tokenId);
        // _setTokenURI(tokenId, string(abi.encodePacked(baseTokenURI, Strings.toString(tokenId), ".json")));
    }

    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        payable(owner()).transfer(balance); // add treasury wallet
    }

    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter;
    }

    function _mint(address to, uint256 tokenId) internal override {
        _tokenIdCounter += 1;
        super._mint(to, tokenId);
    }
}
