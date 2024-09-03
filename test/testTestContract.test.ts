import { expect } from './chai-setup';
import { ethers, deployments, getUnnamedAccounts } from 'hardhat';
import { setupUsers } from './utils';
import { TestContract } from '../typechain/TestContract';
import { MerkleTree } from 'merkletreejs';
import keccak256 from 'keccak256';
import { BigNumber } from 'ethers';

const setup = deployments.createFixture(async () => {
  await deployments.fixture('TestContract');

  const testContract = await deployments.get('TestContract');

  const contracts = {
    TestContract: <TestContract>(
      await ethers.getContractAt(testContract.abi, testContract.address)
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
  return new MerkleTree(leafNodes, keccak256, { sortPairs: true });
};

describe('TestContract', function() {
  it('can mint 1 token for free (Stage 0)', async function() {
    const { users, TestContract } = await setup();

    const freeWhitelist = [users[0].address];
    const freeMerkleTree = generateMerkleTree(freeWhitelist);
    const freeMerkleRoot = freeMerkleTree.getRoot().toString('hex');
    await TestContract.setFreeMerkleRoot('0x' + freeMerkleRoot);
    const expectedTokenId = 1;

    const leaf = keccak256(users[0].address);
    const proof = freeMerkleTree.getHexProof(leaf);

    await TestContract.setMintingState(0);
    await TestContract.toggleMintingIsActive();

    await expect(users[0].TestContract.mint(1, proof, { value: 0 }))
      .to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[0].address,
        expectedTokenId
      );

    console.log(`Owner of tokenId ${expectedTokenId} is: ` + (await TestContract.ownerOf(expectedTokenId)));

    // Test that a user not on the free whitelist cannot mint
    const invalidProof = freeMerkleTree.getHexProof(
      keccak256(users[1].address)
    );
    await expect(
      users[1].TestContract.mint(1, invalidProof, { value: 0 })
    ).to.be.revertedWith('Invalid proof for free minting');

    // Test that a user cannot mint more than 1 token in Stage 0
    await expect(
      users[0].TestContract.mint(2, proof, { value: 0 })
    ).to.be.revertedWith('Can only mint 1 token in Stage 0');
  });

  it('can mint multiple tokens for a price (Stage 1)', async function() {
    const { users, TestContract } = await setup();

    const paidWhitelist = [users[1].address];
    const paidMerkleTree = generateMerkleTree(paidWhitelist);
    const paidMerkleRoot = paidMerkleTree.getRoot().toString('hex');
    await TestContract.setPaidMerkleRoot('0x' + paidMerkleRoot);

    const leaf = keccak256(users[1].address);
    const proof = paidMerkleTree.getHexProof(leaf);

    await TestContract.setMintingState(1);
    await TestContract.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.02');
    const amountToMint = 3;
    const totalPrice = mintPrice.mul(amountToMint);

    await expect(
      users[1].TestContract.mint(amountToMint, proof, { value: totalPrice })
    )
      .to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        1
      )
      .and.to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        2
      )
      .and.to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        3
      );

    console.log(
      'Owner of tokenIds 1, 2, 3 is: ' +
      (await TestContract.ownerOf(1)) +
      ', ' +
      (await TestContract.ownerOf(2)) +
      ', ' +
      (await TestContract.ownerOf(3))
    );

    // Test that a user not on the paid whitelist cannot mint
    const invalidProof = paidMerkleTree.getHexProof(
      keccak256(users[0].address)
    );
    await expect(
      users[0].TestContract.mint(amountToMint, invalidProof, {
        value: totalPrice,
      })
    ).to.be.revertedWith('Invalid proof for paid minting');
  });

  it('anyone can mint multiple tokens for a price (Stage 2)', async function() {
    const { users, TestContract } = await setup();

    await TestContract.setMintingState(2);
    await TestContract.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.03');
    const amountToMint = 2;
    const totalPrice = mintPrice.mul(amountToMint);

    await expect(
      users[2].TestContract.mint(amountToMint, [], { value: totalPrice })
    )
      .to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[2].address,
        1
      )
      .and.to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[2].address,
        2
      );

    console.log(
      'Owner of tokenIds 1, 2 is: ' +
      (await TestContract.ownerOf(1)) +
      ', ' +
      (await TestContract.ownerOf(2))
    );
  });

  it('only the owner can withdraw funds', async function() {
    const { users, TestContract } = await setup();

    // Get the owner of the contract (the deployer)
    const [deployer] = await ethers.getSigners();
    const treasuryAddress = users[1].address;

    await TestContract.setMintingState(2);
    await TestContract.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.03');
    const amountToMint = 1;
    const totalPrice = mintPrice.mul(amountToMint);

    await users[2].TestContract.mint(amountToMint, [], { value: totalPrice });

    // Non-owner tries to withdraw (should fail)
    await expect(users[2].TestContract.withdraw()).to.be.revertedWith(
      `OwnableUnauthorizedAccount`
    );

    // Owner tries to withdraw without treasury (should fail)
    await expect(TestContract.connect(deployer).withdraw()).to.be.revertedWith('Treasury not set')

    // Owner can set treasury
    await expect(TestContract.connect(deployer).setTreasuryWallet(treasuryAddress)).to.not.be.reverted

    const treasuryBalanceBefore = await ethers.provider.getBalance(
      treasuryAddress
    );

    // Owner withdraws
    await TestContract.connect(deployer).withdraw();

    const treasuryBalanceAfter = await ethers.provider.getBalance(
      treasuryAddress
    );

    // Use BigNumber arithmetic for comparison
    const expectedBalanceAfter = treasuryBalanceBefore
      .add(totalPrice)

    // Ensure the balances are equal
    expect(treasuryBalanceAfter).to.equal(expectedBalanceAfter);
  });

  it('can set base URI and verify tokenURI', async function() {
    const { users, TestContract } = await setup();

    // Set base URI
    const baseURI = 'https://example.com/metadata/';
    await TestContract.setBaseURI(baseURI);

    // Mint a token to check the tokenURI
    await TestContract.setMintingState(2);
    await TestContract.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.03');
    await users[2].TestContract.mint(1, [], { value: mintPrice });

    // Verify the tokenURI
    const tokenId = 1;
    const expectedTokenURI = `${baseURI}${tokenId}.json`;
    const actualTokenURI = await TestContract.tokenURI(tokenId);
    expect(actualTokenURI).to.equal(expectedTokenURI);

    console.log(`Token URI for tokenId ${tokenId} is: ${actualTokenURI}`);
  });

  it('owner can set default royalties', async function() {
    const { users, TestContract } = await setup();

    // Get the owner of the contract (the deployer)
    const [deployer] = await ethers.getSigners();
    const notOwner = users[1];

    // Basis point
    const fivePercent = 500

    await expect(notOwner.TestContract.setDefaultRoyalties(notOwner.address, fivePercent)).to.be.revertedWith('OwnableUnauthorizedAccount');
    await expect(TestContract.connect(deployer).setDefaultRoyalties(deployer.address, fivePercent)).to.not.be.reverted;
    const royaltyInfo = await TestContract.royaltyInfo(0, 1000)
    expect(royaltyInfo[0]).to.equal(deployer.address)
    expect(royaltyInfo[1]).to.equal(BigNumber.from(50))

  });
  it('should allow to mint up to maxium', async function() {
    const { users, TestContract } = await setup();

    const paidWhitelist = [users[1].address];
    const paidMerkleTree = generateMerkleTree(paidWhitelist);
    const paidMerkleRoot = paidMerkleTree.getRoot().toString('hex');
    await TestContract.setPaidMerkleRoot('0x' + paidMerkleRoot);

    const leaf = keccak256(users[1].address);
    const proof = paidMerkleTree.getHexProof(leaf);

    await TestContract.setMintingState(1);
    await TestContract.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.02');
    const amountToMint = 625;
    const totalPrice = mintPrice.mul(amountToMint);

    await expect(
      users[1].TestContract.mint(amountToMint, proof, { value: totalPrice })
    )
      .to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        625
      );
    await expect(
      users[1].TestContract.mint(amountToMint, proof, { value: totalPrice })
    )
      .to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        1250
      );
    await expect(
      users[1].TestContract.mint(amountToMint, proof, { value: totalPrice })
    )
      .to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        1875
      );
    await expect(
      users[1].TestContract.mint(amountToMint, proof, { value: totalPrice })
    )
      .to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        2500
      );
    await expect(
      users[1].TestContract.mint(1, proof, { value: mintPrice })
    )
      .to.revertedWith('Minting amount exceeds maximum supply');
      expect(await users[1].TestContract.totalSupply()).to.equal(2500);

  });
});
