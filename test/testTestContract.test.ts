import {expect} from './chai-setup';
import {ethers, deployments, getUnnamedAccounts} from 'hardhat';
import {setupUsers} from './utils';
import {TestContract} from '../typechain/TestContract';
import {MerkleTree} from 'merkletreejs';
import keccak256 from 'keccak256';
import {Test} from 'mocha';

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
  return new MerkleTree(leafNodes, keccak256, {sortPairs: true});
};

describe('TestContract', function () {
  it('can mint 1 token for free (Stage 0)', async function () {
    const {users, TestContract} = await setup();

    const freeWhitelist = [users[0].address];
    const freeMerkleTree = generateMerkleTree(freeWhitelist);
    const freeMerkleRoot = freeMerkleTree.getRoot().toString('hex');
    await TestContract.setFreeMerkleRoot('0x' + freeMerkleRoot);

    const leaf = keccak256(users[0].address);
    const proof = freeMerkleTree.getHexProof(leaf);

    await TestContract.setMintingState(0);
    await TestContract.toggleMintingIsActive();

    await expect(users[0].TestContract.mint(1, proof, {value: 0}))
      .to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[0].address,
        1
      );

    console.log('Owner of tokenId 1 is: ' + (await TestContract.ownerOf(1)));

    // Test that a user not on the free whitelist cannot mint
    const invalidProof = freeMerkleTree.getHexProof(
      keccak256(users[1].address)
    );
    await expect(
      users[1].TestContract.mint(1, invalidProof, {value: 0})
    ).to.be.revertedWith('Invalid proof for free minting');

    // Test that a user cannot mint more than 1 token in Stage 0
    await expect(
      users[0].TestContract.mint(2, proof, {value: 0})
    ).to.be.revertedWith('Can only mint 1 token in Stage 0');
  });

  it('can mint multiple tokens for a price (Stage 1)', async function () {
    const {users, TestContract} = await setup();

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
      users[1].TestContract.mint(amountToMint, proof, {value: totalPrice})
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

  it('anyone can mint multiple tokens for a price (Stage 2)', async function () {
    const {users, TestContract} = await setup();

    await TestContract.setMintingState(2);
    await TestContract.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.1');
    const amountToMint = 2;
    const totalPrice = mintPrice.mul(amountToMint);

    await expect(
      users[2].TestContract.mint(amountToMint, [], {value: totalPrice})
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

  it('only the owner can withdraw funds', async function () {
    const {users, TestContract} = await setup();

    // Get the owner of the contract (the deployer)
    const [deployer] = await ethers.getSigners();

    await TestContract.setMintingState(2);
    await TestContract.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.1');
    const amountToMint = 1;
    const totalPrice = mintPrice.mul(amountToMint);

    await users[2].TestContract.mint(amountToMint, [], {value: totalPrice});

    const ownerBalanceBefore = await ethers.provider.getBalance(
      deployer.address
    );

    // Non-owner tries to withdraw (should fail)
    await expect(users[1].TestContract.withdraw()).to.be.revertedWith(
      'Ownable: caller is not the owner'
    );

    // Owner withdraws
    const tx = await TestContract.connect(deployer).withdraw();
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

    const ownerBalanceAfter = await ethers.provider.getBalance(
      deployer.address
    );

    // Use BigNumber arithmetic for comparison
    const expectedBalanceAfter = ownerBalanceBefore
      .add(totalPrice)
      .sub(gasUsed);

    // Ensure the balances are equal
    expect(ownerBalanceAfter).to.equal(expectedBalanceAfter);
  });

  it('can set base URI and verify tokenURI', async function () {
    const {users, TestContract} = await setup();

    // Set base URI
    const baseURI = 'https://example.com/metadata/';
    await TestContract.setBaseURI(baseURI);

    // Mint a token to check the tokenURI
    await TestContract.setMintingState(2);
    await TestContract.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.1');
    await users[2].TestContract.mint(1, [], {value: mintPrice});

    // Verify the tokenURI
    const tokenId = 1;
    const expectedTokenURI = `${baseURI}${tokenId}.json`;
    const actualTokenURI = await TestContract.tokenURI(tokenId);
    expect(actualTokenURI).to.equal(expectedTokenURI);

    console.log(`Token URI for tokenId ${tokenId} is: ${actualTokenURI}`);
  });
});
