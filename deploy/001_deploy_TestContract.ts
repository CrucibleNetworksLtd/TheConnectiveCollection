import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
// import {parseEther} from 'ethers/lib/utils';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const {deployer} = await getNamedAccounts();

  await deploy('TestContract', {
    from: deployer,
    log: true,
    args: ['Sample Name', 'SN'],
    // gasLimit: 6000000,
  });
};
export default func;
func.tags = ['TestContract'];
