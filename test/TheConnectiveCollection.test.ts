import {expect} from './chai-setup';
import {ethers, deployments, getUnnamedAccounts} from 'hardhat';
import {setupUsers} from './utils';
import {TheConnectiveCollection} from '../typechain/TheConnectiveCollection';
import {MerkleTree} from 'merkletreejs';
import keccak256 from 'keccak256';
import {BigNumber} from 'ethers';

const setup = deployments.createFixture(async () => {
  await deployments.fixture('TheConnectiveCollection');

  const contract = await deployments.get('TheConnectiveCollection');

  const contracts = {
    TheConnectiveCollection: <TheConnectiveCollection>(
      await ethers.getContractAt(contract.abi, contract.address)
    ),
  };
  const users = await setupUsers(await getUnnamedAccounts(), contracts);
  return {
    ...contracts,
    users,
  };
});

const generateMerkleTree = (addresses: string[]) => {
  const leafNodes = addresses.map((addr) => keccak256(addr));
  return new MerkleTree(leafNodes, keccak256, {sortPairs: true});
};

describe('TheConnectiveCollection', function () {
  it('should allow minting 1 token for free in Free Minting Phase', async function () {
    const {users, TheConnectiveCollection} = await setup();

    const freeWhitelist = [users[0].address];
    const freeMerkleTree = generateMerkleTree(freeWhitelist);
    const freeMerkleRoot = freeMerkleTree.getRoot().toString('hex');
    await TheConnectiveCollection.setFreeMerkleRoot('0x' + freeMerkleRoot);
    const expectedTokenId = 1;

    const leaf = keccak256(users[0].address);
    const proof = freeMerkleTree.getHexProof(leaf);

    await TheConnectiveCollection.toggleMintingIsActive();

    await expect(users[0].TheConnectiveCollection.mint(1, proof, {value: 0}))
      .to.emit(TheConnectiveCollection, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[0].address,
        expectedTokenId
      );

    // Test that a user not on the free whitelist cannot mint
    const invalidProof = freeMerkleTree.getHexProof(
      keccak256(users[1].address)
    );
    await expect(
      users[1].TheConnectiveCollection.mint(1, invalidProof, {value: 0})
    ).to.be.revertedWith('Invalid proof for free minting');

    // Test that a user cannot mint more than 1 token in Phase 0
    await expect(
      users[0].TheConnectiveCollection.mint(2, proof, {value: 0})
    ).to.be.revertedWith('Can only mint 1 token in Phase 0');
  });

  it('should allow minting 1 token for a discounted price (Discount Phase)', async function () {
    const {users, TheConnectiveCollection} = await setup();

    const discountWhitelist = [users[1].address, users[2].address];
    const discountMerkleTree = generateMerkleTree(discountWhitelist);
    const discountMerkleRoot = discountMerkleTree.getRoot().toString('hex');
    await TheConnectiveCollection.setDiscountMerkleRoot('0x' + discountMerkleRoot);

    const leaf = keccak256(users[1].address);
    const proof = discountMerkleTree.getHexProof(leaf);

    await TheConnectiveCollection.advanceMintingPhase();
    await TheConnectiveCollection.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.02');

    // Mint 1 token for the discounted price
    await expect(users[1].TheConnectiveCollection.mint(1, proof, {value: mintPrice}))
      .to.emit(TheConnectiveCollection, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        1
      );

    // Test that the same user cannot mint more than 1 token during the discount phase
    await expect(
      users[1].TheConnectiveCollection.mint(1, proof, {value: mintPrice})
    ).to.be.revertedWith('Already minted in Phase 1');

    // Test that a user not on the discount whitelist cannot mint
    const invalidProof = discountMerkleTree.getHexProof(
      keccak256(users[0].address)
    );
    await expect(
      users[0].TheConnectiveCollection.mint(1, invalidProof, {value: mintPrice})
    ).to.be.revertedWith('Invalid proof for discount minting');

    // Test that a user cannot use another's proof to mint
    const validProof = discountMerkleTree.getHexProof(
      keccak256(users[2].address)
    );
    await expect(
      users[1].TheConnectiveCollection.mint(1, validProof, {value: mintPrice})
    ).to.be.revertedWith('Invalid proof for discount minting');
  });

  it('should allow anyone to mint multiple tokens for the full price (Open Phase)', async function () {
    const {users, TheConnectiveCollection} = await setup();

    await TheConnectiveCollection.advanceMintingPhase();
    await TheConnectiveCollection.advanceMintingPhase();
    await TheConnectiveCollection.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.03');
    const amountToMint = 2;
    const totalPrice = mintPrice.mul(amountToMint);

    await expect(
      users[2].TheConnectiveCollection.mint(amountToMint, [], {value: totalPrice})
    )
      .to.emit(TheConnectiveCollection, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[2].address,
        1
      )
      .and.to.emit(TheConnectiveCollection, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[2].address,
        2
      );
  });

  it('should allow only the owner to withdraw funds', async function () {
    const {users, TheConnectiveCollection} = await setup();

    // Get the owner of the contract (the deployer)
    const [deployer] = await ethers.getSigners();
    const treasuryAddress = users[1].address;

    await TheConnectiveCollection.advanceMintingPhase();
    await TheConnectiveCollection.advanceMintingPhase();
    await TheConnectiveCollection.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.03');
    const amountToMint = 1;
    const totalPrice = mintPrice.mul(amountToMint);

    await users[2].TheConnectiveCollection.mint(amountToMint, [], {value: totalPrice});

    // Non-owner tries to withdraw (should fail)
    await expect(users[2].TheConnectiveCollection.withdraw()).to.be.revertedWith(
      `OwnableUnauthorizedAccount`
    );

    // Owner tries to withdraw without treasury (should fail)
    await expect(TheConnectiveCollection.connect(deployer).withdraw()).to.be.revertedWith(
      'Treasury not set'
    );

    // Owner can set treasury
    await expect(
      TheConnectiveCollection.connect(deployer).setTreasuryWallet(treasuryAddress)
    ).to.not.be.reverted;

    const treasuryBalanceBefore = await ethers.provider.getBalance(
      treasuryAddress
    );

    // Owner withdraws
    await TheConnectiveCollection.connect(deployer).withdraw();

    const treasuryBalanceAfter = await ethers.provider.getBalance(
      treasuryAddress
    );

    // Use BigNumber arithmetic for comparison
    const expectedBalanceAfter = treasuryBalanceBefore.add(totalPrice);

    // Ensure the balances are equal
    expect(treasuryBalanceAfter).to.equal(expectedBalanceAfter);
  });

  it('should allow to set base URI and verify tokenURI', async function () {
    const {users, TheConnectiveCollection} = await setup();

    // Set base URI
    const baseURI = 'https://example.com/metadata/';
    await TheConnectiveCollection.setBaseURI(baseURI);

    // Mint a token to check the tokenURI
    await TheConnectiveCollection.advanceMintingPhase();
    await TheConnectiveCollection.advanceMintingPhase();
    await TheConnectiveCollection.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.03');
    await users[2].TheConnectiveCollection.mint(1, [], {value: mintPrice});

    // Verify the tokenURI
    const tokenId = 1;
    const expectedTokenURI = `${baseURI}${tokenId}.json`;
    const actualTokenURI = await TheConnectiveCollection.tokenURI(tokenId);
    expect(actualTokenURI).to.equal(expectedTokenURI);
  });

  it('should allow the owner to set default royalties', async function () {
    const {users, TheConnectiveCollection} = await setup();

    // Get the owner of the contract (the deployer)
    const [deployer] = await ethers.getSigners();
    const notOwner = users[1];

    // Basis point
    const fivePercent = 500;

    await expect(
      notOwner.TheConnectiveCollection.setDefaultRoyalties(notOwner.address, fivePercent)
    ).to.be.revertedWith('OwnableUnauthorizedAccount');
    await expect(
      TheConnectiveCollection.connect(deployer).setDefaultRoyalties(
        deployer.address,
        fivePercent
      )
    ).to.not.be.reverted;
    const royaltyInfo = await TheConnectiveCollection.royaltyInfo(0, 1000);
    expect(royaltyInfo[0]).to.equal(deployer.address);
    expect(royaltyInfo[1]).to.equal(BigNumber.from(50));
  });
  it('should allow to open minting up to maxium', async function () {
    const {users, TheConnectiveCollection} = await setup();

    await TheConnectiveCollection.advanceMintingPhase();
    await TheConnectiveCollection.advanceMintingPhase();
    await TheConnectiveCollection.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.03');
    const amountToMint = 625;
    const totalPrice = mintPrice.mul(amountToMint);

    await expect(
      users[1].TheConnectiveCollection.mint(amountToMint, [], {value: totalPrice})
    )
      .to.emit(TheConnectiveCollection, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        625
      );
    await expect(
      users[1].TheConnectiveCollection.mint(amountToMint, [], {value: totalPrice})
    )
      .to.emit(TheConnectiveCollection, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        1250
      );
    await expect(
      users[1].TheConnectiveCollection.mint(amountToMint, [], {value: totalPrice})
    )
      .to.emit(TheConnectiveCollection, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        1875
      );
    await expect(
      users[1].TheConnectiveCollection.mint(amountToMint, [], {value: totalPrice})
    )
      .to.emit(TheConnectiveCollection, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        2500
      );
    await expect(
      users[1].TheConnectiveCollection.mint(1, [], {value: mintPrice})
    ).to.revertedWith('Minting amount exceeds maximum supply');
    expect(await users[1].TheConnectiveCollection.totalSupply()).to.equal(2500);
  });

  it('should allow open minting up to leftover minting maximum with 1 token per wallet in the discount phase', async function () {
    const {users, TheConnectiveCollection} = await setup();

    const freeWhitelist = [users[0].address];
    const discountWhitelist = [users[1].address, users[2].address];
    const freeMintingAmount = 1;
    const openMintingBatchAmount = 832;
    const freeMerkleTree = generateMerkleTree(freeWhitelist);
    const freeMerkleRoot = freeMerkleTree.getRoot().toString('hex');
    const discountMerkleTree = generateMerkleTree(discountWhitelist);
    const discountMerkleRoot = discountMerkleTree.getRoot().toString('hex');
    await TheConnectiveCollection.setFreeMerkleRoot('0x' + freeMerkleRoot);
    await TheConnectiveCollection.setDiscountMerkleRoot('0x' + discountMerkleRoot);

    const freeProof = freeMerkleTree.getHexProof(keccak256(users[0].address));
    const discountProof = discountMerkleTree.getHexProof(
      keccak256(users[1].address)
    );
    await TheConnectiveCollection.toggleMintingIsActive();

    const totalSupply = 2500;
    const discountMintingPrice = ethers.utils.parseEther('0.02');
    const openMintingPrice = ethers.utils.parseEther('0.03');

    // Free minting phase for users[0]
    await expect(
      users[0].TheConnectiveCollection.mint(freeMintingAmount, freeProof, {value: 0})
    )
      .to.emit(TheConnectiveCollection, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[0].address,
        freeMintingAmount
      );

    // Move to discount phase
    await TheConnectiveCollection.advanceMintingPhase();

    // Discount phase - users[1] can mint only 1 token, despite the attempt for more
    await expect(
      users[1].TheConnectiveCollection.mint(1, discountProof, {
        value: discountMintingPrice,
      })
    )
      .to.emit(TheConnectiveCollection, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        freeMintingAmount + 1
      );

    // Attempting to mint more than 1 token during discount phase should revert
    await expect(
      users[1].TheConnectiveCollection.mint(1, discountProof, {
        value: discountMintingPrice,
      })
    ).to.be.revertedWith('Already minted in Phase 1');

    // Move to open minting phase
    await TheConnectiveCollection.advanceMintingPhase();

    // Open minting phase - users[2] can mint a larger batch
    await expect(
      users[2].TheConnectiveCollection.mint(openMintingBatchAmount, [], {
        value: openMintingPrice.mul(openMintingBatchAmount),
      })
    )
      .to.emit(TheConnectiveCollection, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[2].address,
        openMintingBatchAmount +
          1 + // The token from free minting phase
          1 // The token from discount phase
      );

    await users[2].TheConnectiveCollection.mint(openMintingBatchAmount, [], {
      value: openMintingPrice.mul(openMintingBatchAmount),
    });

    await users[2].TheConnectiveCollection.mint(openMintingBatchAmount, [], {
      value: openMintingPrice.mul(openMintingBatchAmount),
    });

    await users[2].TheConnectiveCollection.mint(2, [], {
      value: openMintingPrice.mul(2),
    });

    // Test max supply is respected
    await expect(
      users[2].TheConnectiveCollection.mint(1, [], {value: openMintingPrice})
    ).to.be.revertedWith('Minting amount exceeds maximum supply');

    expect(await TheConnectiveCollection.totalSupply()).to.equal(totalSupply);
  });

  it('should allow owner to mint for free in phase 2', async function () {
    const {TheConnectiveCollection} = await setup();

    const [deployer] = await ethers.getSigners();
    await TheConnectiveCollection.toggleMintingIsActive();
    await expect(TheConnectiveCollection.connect(deployer).ownerMint(1)).to.revertedWith(
      'Owner minting is only available in Phase 2'
    );
    await TheConnectiveCollection.advanceMintingPhase();
    await expect(TheConnectiveCollection.connect(deployer).ownerMint(1)).to.revertedWith(
      'Owner minting is only available in Phase 2'
    );
    await TheConnectiveCollection.advanceMintingPhase();
    await expect(TheConnectiveCollection.connect(deployer).ownerMint(2))
      .to.emit(TheConnectiveCollection, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        deployer.address,
        2
      );
  });
});
