import * as driver from 'bigchaindb-driver';
import * as bip39 from 'bip39';

import * as dotenv from 'dotenv';
dotenv.config();

import { AuthzAsset } from './AuthzAsset';
import { AuthzSet } from './AuthzSet';
import { AuthzOperations } from './AuthzOperations';
import { AuthzAction } from './AuthzAction';
import { AuthzPermissions } from './AuthzPermissions';
import { AuthzMetadata } from './AuthzMetadata';

/**
 * BCDBAuthz is the facade class that should be used to work with bcdb-authz.
 */
export class BcdbAuthz {

    private bcdbAuthzId = "bcdbauthzid";
    private bcbdAuthzActionVersion = "0.0.1";
    private connection: any;

    loggingEnabled: boolean = true;

    /**
     * Initialise a new BCDBAuthz facade class.
     * @constructor
     * 
     * @param {string} bigchaindbUrl - The URL of the bigchaindb network you want to connect to.
     * @param {string} appId - Your app ID.
     * @param {string} appKey - Your app Key.
     */
    constructor(public bigchaindbUrl: string, public appId: string, public appKey: string) {
        this.connection = new driver.Connection(this.bigchaindbUrl, {
            app_id: this.appId,
            app_key: this.appKey
        })
    }

    /**
     * Generate a unique AuthzAsset identifier.
     * @returns {string} The generated AuthzAssetId.
     */
    generateAuthzAssetId(): string {
        return this.bcdbAuthzId + "-" + this.s4() + this.s4() + "-" + this.s4() + "-" + this.s4() + "-" + this.s4() + "-" + this.s4() + this.s4() + this.s4();
    }

    /**
     * Generate keypair with bip39
     * @param {string} keySeed - The seed that will be used to create a keypair using bip39.
     * @returns {any} The generated keypair.
     */
    generateKeyByBip39(keySeed: string): any {
        return new driver.Ed25519Keypair(bip39.mnemonicToSeed(keySeed).slice(0, 32));
    }

    /**
     * Thank you https://stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
     * 
     * Generate a random string of 4 hexadecimal characters.
     * @returns {string} The generated string.
     */
    private s4(): string {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }

    /**
     * Create a new asset that should have its authorization controlled on bigchaindb.
     * @param {string} assetKeySeed - The seed that will be used to generate the keypair which will be used to update the asset in the future.
     * @returns {Promise<any>} The newly created transaction wrapped in a promise.
     */
    createAsset(assetKeySeed: string): Promise<AuthzAsset> {

        return new Promise<AuthzAsset>((resolve, reject) => {

            // Generate an identity with the supplied assetKey.
            let identity = this.generateKeyByBip39(assetKeySeed);

            // Generate a new identity for the AuthzAsset.
            let authId = this.generateAuthzAssetId();

            // Wrap the AuthzAssetId in an asset object
            let assetData = {
                "bcdbauthzid": authId,
            };

            // Construct a new create transaction to add the asset to the bigchaindb.
            const newCreateTransaction = driver.Transaction.makeCreateTransaction(
                assetData,
                null,

                // A transaction needs an output
                [driver.Transaction.makeOutput(
                    driver.Transaction.makeEd25519Condition(identity.publicKey))
                ],
                identity.publicKey
            );

            // Sign the transaction with the supplied identity.
            const signedTransaction = driver.Transaction.signTransaction(newCreateTransaction, identity.privateKey);

            // Post the transaction to the bigchaindb.
            this.connection.postTransaction(signedTransaction).then(signedTransaction => {

                // Wait for the transaction to complete and return it.
                return this.connection.pollStatusAndFetchTransaction(signedTransaction.id);
            }).then(response => {

                // Initalise a new AuthzAsset from the response.
                resolve(new AuthzAsset(response.id, response.asset.data.bcdbauthzid));
            }).catch(error => {

                // Throw the error.
                reject(error)
            });
        });
    }

    /**
     * Return an asset from the BigchainDB by using its ID.
     * @param {string} assetId - The ID of the asset hashed by the algorithm used by BigchainDB.
     */
    getAsset(assetId: string): Promise<AuthzAsset> {

        return new Promise<AuthzAsset>((resolve, reject) => {

            // Search for assets
            this.connection.searchAssets(assetId).then(response => {

                // Return an AuthzAsset generated from the first asset in the response.
                let returnedAuthzAsset = new AuthzAsset(response[0].id, response[0].data.bcdbauthzid);
                resolve(returnedAuthzAsset);
            }).catch(error => {

                // Throw the error.
                reject(error);
            })
        });
    }

    /**
     * Search an asset based on its bcdbauthzid, which is a unique identifier it was given on creation.
     * @param {string} bcdbAuthzId - The bcdbauthzid of the asset we're looking for.
     */
    searchAssetByBcdbAuthzId(bcdbAuthzId: string): Promise<AuthzAsset> {

        return new Promise<AuthzAsset>((resolve, reject) => {
            this.connection.searchAssets(`'${bcdbAuthzId}'`).then(assetQueryList => {
                return this.getAsset(assetQueryList[0].id);
            }).then(returnedAsset => {
                resolve(returnedAsset);
            }).catch(error => {

                // Throw the error.
                reject(error);
            })
        });
    }

    /**
     * Update the persmissions for a certain asset with supplied ID and where transactions can be performed upon by using the keypair that can be generated with supplied keySeed.
     * 
     * @param {string} assetId - The ID of the asset we want to update the permissions from.
     * @param {string} keySeed - The seed we want to use to generate a keypair, which we will use to sign the transaction.
     * @param {AuthzAction} authzAction - The operation that needs to be performed on the asset with supplied ID.
     */
    updateAsset(assetId: string, keySeed: string, authzAction: AuthzAction): Promise<AuthzAsset> {
        return new Promise<AuthzAsset>((resolve, reject) => {

            // Generate keypair with supplied keySeed.
            let identity = this.generateKeyByBip39(keySeed);

            // Search for the latest transaction that is involved in this asset.
            this.connection.listTransactions(assetId).then(transactionList => {

                // Pull the transaction that we want to update. (the latest one)
                return this.connection.getTransaction(transactionList[transactionList.length - 1].id);

            }).then(returnedTransaction => {

                // Create a transfer transaction in which we use the new identity as output.
                const updatePermissionsTransaction = driver.Transaction.makeTransferTransaction(
                    // signedTx to transfer and output index
                    [{ tx: returnedTransaction, output_index: 0 }],

                    [driver.Transaction.makeOutput(driver.Transaction.makeEd25519Condition(identity.publicKey))],

                    // metadata
                    new AuthzMetadata("action", authzAction)
                );

                // We sign the new transaction.
                const signedUpdatePermissionsTransaction = driver.Transaction.signTransaction(updatePermissionsTransaction, identity.privateKey);

                // Send the TRANSFER transaction.
                return this.connection.postTransaction(signedUpdatePermissionsTransaction);
            }).then(signedUpdatePermissionsTransaction => {

                // Poll for status and move on.
                return this.connection.pollStatusAndFetchTransaction(signedUpdatePermissionsTransaction.id);
            }).then(response => {

                // Return the required asset. for some reason this doesn't work. Will fix later.
                //resolve(new AuthzAsset(response.id, response.asset.data.bcdbauthzid));
                resolve(response);
            }).catch(error => {

                // Throw the error
                reject(error);
            });
        })
    }

    /**
     * Get the latest transaction for a certain asset with supplied ID.
     * 
     * @param {string} assetId - The ID of the asset we want to return the latest transaction from.
     */
    getLatestTransaction(assetId: string): Promise<any> {
        return new Promise<any>((resolve, reject) => {

            // Get a list of all transactions for a certain asset.
            this.log(`Get a list of all transactions for asset with id: ${assetId}.`);
            this.connection.listTransactions(assetId).then(transactionList => {

                this.log(`Reponse received, loaded ${transactionList.length} transactions.`);
                this.log(`Pull the latest transaction from this list.`);

                // Pull the transaction that we want to update. (the latest one)
                resolve(this.connection.getTransaction(transactionList[transactionList.length - 1].id));
            }).catch(error => {

                // Throw the error.
                reject(new Error(error));
            });
        });
    }

    /**
     * Get a Map of permissions for an asset with supplied ID, for a specific moment in time.
     * 
     * @param {string} assetId - The ID of the asset we want to know the permissions from.
     * @param {Date} [date = new Date()] - The Date of the moment we want to know all permissions from.
     * 
     * @returns {Promise<Map<string, AuthzSet>>} A promise that can be resolved to return the Map.
     */
    getAssetPermissions(assetId: string, date: Date = new Date()): Promise<Map<string, AuthzSet>> {
        return new Promise<Map<string, AuthzSet>>((resolve, reject) => {

            // Get a list of all transactions for a certain asset
            this.log(`Get a list of all transactions for asset with id: ${assetId}.`);
            this.connection.listTransactions(assetId).then(transactionList => {

                let authzMap = new Map<string, AuthzSet>();

                this.log(`Iterate over ${transactionList.length} transaction(s).`);
                // Iterate over transactions and parse actions.
                for (let transaction of transactionList) {

                    this.log(transaction, false);

                    // Check if the transaction is an action. (An action means that it contains a change in permissions)
                    if (transaction.metadata != null && typeof transaction.metadata != "undefined" && transaction.metadata.type == "action") {
                        let authzActionString = transaction.metadata.data;
                        let authzAction = AuthzAction.fromMetadata(authzActionString);
                        //let authzAction = new AuthzAction(authzActionString.operation, authzActionString.permission, authzActionString.subject);

                        this.log(`AuthzAction performed: `);
                        this.log(authzAction, false);

                        // Check if we want to check if the AuthzAction was performed after the date we want to query:
                        let authzDate = new Date(authzActionString.date);
                        if (authzDate > date) resolve(authzMap);


                        // Parse the permissions into the authzMap.
                        this.log(`Parsing AuthzAction to add to the AuthzSet of stakeholder '${authzAction.subject}'.`)
                        if (typeof authzMap.get(authzAction.subject) == "undefined") authzMap.set(authzAction.subject, new AuthzSet());

                        switch (authzAction.permission) {
                            case AuthzPermissions.CREATE:
                                this.log(`CREATE`);
                                if (authzAction.operation == AuthzOperations.GRANT) authzMap.get(authzAction.subject).permissions.add(AuthzPermissions.CREATE);
                                else authzMap.get(authzAction.subject).permissions.delete(AuthzPermissions.CREATE);
                                break;

                            case AuthzPermissions.READ:
                                this.log(`READ`);
                                if (authzAction.operation == AuthzOperations.GRANT) authzMap.get(authzAction.subject).permissions.add(AuthzPermissions.READ);
                                else authzMap.get(authzAction.subject).permissions.delete(AuthzPermissions.READ);
                                break;

                            case AuthzPermissions.UPDATE:
                                this.log(`UPDATE`);
                                if (authzAction.operation == AuthzOperations.GRANT) authzMap.get(authzAction.subject).permissions.add(AuthzPermissions.UPDATE);
                                else authzMap.get(authzAction.subject).permissions.delete(AuthzPermissions.UPDATE);
                                break;

                            case AuthzPermissions.DELETE:
                                this.log(`DELETE`);
                                if (authzAction.operation == AuthzOperations.GRANT) authzMap.get(authzAction.subject).permissions.add(AuthzPermissions.DELETE);
                                else authzMap.get(authzAction.subject).permissions.delete(AuthzPermissions.DELETE);
                                break;

                            case AuthzPermissions.ALL:
                                this.log(`ALL`);
                                if (authzAction.operation == AuthzOperations.GRANT) {
                                    authzMap.get(authzAction.subject).permissions.add(AuthzPermissions.CREATE);
                                    authzMap.get(authzAction.subject).permissions.add(AuthzPermissions.READ);
                                    authzMap.get(authzAction.subject).permissions.add(AuthzPermissions.UPDATE);
                                    authzMap.get(authzAction.subject).permissions.add(AuthzPermissions.DELETE);
                                }
                                else {
                                    authzMap.delete(authzAction.subject);
                                }
                        }
                    }
                }

                resolve(authzMap);
            }).catch(error => {

                // Throw the error.
                reject(error);
            });

        });
    }

    /**
     * Get a Set that contains all permissions for an asset with supplied ID for a certain stakeholder that is associated by an external service with the supplied stakeholderId at a specific moment in time.
     * 
     * @param {string} assetId - The ID from the asset we want to return the persmissions from.
     * @param {string} stakeholderId - The ID of the stakeholder.
     * @param {Date} date - The Date of the moment we want to know the permissions from.
     * 
     * @returns {Promise<AuthSet>} - A promise that can be resolved to return the AuthzSet for the stakeholder.
     */
    getAssetPermissionsByPerson(assetId: string, stakeholderId: string, date: Date = new Date()): Promise<AuthzSet> {
        return new Promise((resolve, reject) => {
                this.getAssetPermissions(assetId, date).then(authzMap => {

                    if (typeof authzMap.get(stakeholderId) == "undefined") resolve(new AuthzSet());
                    resolve(authzMap.get(stakeholderId));
                }).catch(error => {

                    // Throw the error.
                    reject(error);
                });
        });
    }

    /**
     * Update the keypair that can be used to sign a certain transaction.
     * 
     * @param {string} assetId - The ID of the asset we want to update the keys from.
     * @param {string} oldKeySeed - The seed we want to use to generate the old keypair.
     * @param {string} newKeySeed - The seed we want to use to generate the new keypair.
     */
    updateAssetKey(assetId: string, oldKeySeed: string, newKeySeed: string): Promise<AuthzAsset> {
        return new Promise((resolve, reject) => {
                // Generate keypairs from seeds.
                this.log("Generating keypairs from supplied keys.");
                let oldIdentity = this.generateKeyByBip39(oldKeySeed);
                let newIdentity = this.generateKeyByBip39(newKeySeed);

                // Pulling latest transaction from asset.
                this.getLatestTransaction(assetId).then(returnedTransaction => {

                    this.log(`Generating TRANSFER transaction.`);

                    // Create a transfer transaction in which we use the new identity as output.
                    const updateKeyTransaction = driver.Transaction.makeTransferTransaction(
                        // signedTx to transfer and output index
                        [{ tx: returnedTransaction, output_index: 0 }],

                        [driver.Transaction.makeOutput(driver.Transaction.makeEd25519Condition(newIdentity.publicKey))],

                        // metadata
                        new AuthzMetadata("update-key")
                    );

                    this.log(`Signing transfer transaction.`);

                    // We sign the new transaction with the old identity.
                    const signedUpdateKeyTransaction = driver.Transaction.signTransaction(updateKeyTransaction, oldIdentity.privateKey);

                    // Send the TRANSFER transaction.
                    this.log("Posting newly created transaction to the network.");
                    return this.connection.postTransaction(signedUpdateKeyTransaction);
                }).then(signedUpdateKeyTransaction => {

                    // Poll for status and move on.
                    this.log("Polling for the created transactions' status.");
                    return this.connection.pollStatusAndFetchTransaction(signedUpdateKeyTransaction.id);
                }).then(response => {

                    this.log("Response transaction received:");
                    this.log(response, false);

                    this.log("Query for the asset this transaction belongs to.");
                    // Get the asset from the transaction
                    return this.getAsset(response.asset.id);
                }).then(returnedAsset => {
                    this.log(`Asset received, id: ${returnedAsset.assetId}`);
                    resolve(returnedAsset);
                }).catch(error => {

                    // Throw the error.
                    reject(error);
                });
        })
    }

    /**
     * Log output to the console.
     * 
     * @param {any} message - The message that needs to be logged to the console.
     * @param {boolean} [isText=true] - A boolean that states that the message should be handled as text or as an object.
     */
    public log(message: any, isText: boolean = true) {

        // Parse the time
        let time = new Date().toLocaleTimeString();

        if (this.loggingEnabled) {
            if (isText) {
                console.log(`${time}: ${message}`);
            }
            else {
                console.log(`${time}`);
                console.log(message);
            }
        }
    }
}

export { AuthzAction };
export { AuthzOperations };
export { AuthzPermissions };