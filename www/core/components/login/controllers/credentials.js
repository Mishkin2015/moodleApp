// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

angular.module('mm.core.login')

/**
 * Controller to handle input of user credentials.
 *
 * @module mm.core.login
 * @ngdoc controller
 * @name mmLoginCredentialsCtrl
 */
.controller('mmLoginCredentialsCtrl', function($scope, $stateParams, $mmSitesManager, $mmUtil, $ionicHistory, $mmApp,
            $q, $mmLoginHelper, $mmContentLinksDelegate, $mmContentLinksHelper, $translate, $mmMetadb, $mmApicalls, $rootScope) {

    $scope.siteurl = $stateParams.siteurl;
    $scope.credentials = {
        username: $stateParams.username
    };

    var siteChecked = false,
        urlToOpen = $stateParams.urltoopen,
        siteConfig = $stateParams.siteconfig;

    treatSiteConfig(siteConfig);

    $mmMetadb.initDB();

    // Function to check if a site uses local_mobile, requires SSO login, etc.
    // This should be used only if a fixed URL is set, otherwise this check is already performed in mmLoginSiteCtrl.
    function checkSite(siteurl) {
        // If the site is configured with http:// protocol we force that one, otherwise we use default mode.
        var checkmodal = $mmUtil.showModalLoading(),
            protocol = siteurl.indexOf('http://') === 0 ? 'http://' : undefined;
        return $mmSitesManager.checkSite(siteurl, protocol).then(function(result) {

            siteChecked = true;
            $scope.siteurl = result.siteurl;

            treatSiteConfig(result.config);

            if (result && result.warning) {
                $mmUtil.showErrorModal(result.warning, true, 4000);
            }

            if ($mmLoginHelper.isSSOLoginNeeded(result.code)) {
                // SSO. User needs to authenticate in a browser.
                $scope.isBrowserSSO = true;

                // Check that there's no SSO authentication ongoing and the view hasn't changed.
                if (!$mmApp.isSSOAuthenticationOngoing() && !$scope.$$destroyed) {
                    $mmLoginHelper.confirmAndOpenBrowserForSSOLogin(
                                result.siteurl, result.code, result.service, result.config && result.config.launchurl);
                }
            } else {
                $scope.isBrowserSSO = false;
            }

        }).catch(function(error) {
            $mmUtil.showErrorModal(error);
            return $q.reject();
        }).finally(function() {
            checkmodal.dismiss();
        });
    }

    // Treat the site's config, setting scope variables.
    function treatSiteConfig(siteConfig) {
        if (siteConfig) {
            $scope.sitename = siteConfig.sitename;
            $scope.logourl = siteConfig.logourl || siteConfig.compactlogourl;
            $scope.authInstructions = siteConfig.authinstructions || $translate.instant('mm.login.loginsteps');
            $scope.canSignup = siteConfig.registerauth == 'email';
        } else {
            $scope.sitename = null;
            $scope.logourl = null;
            $scope.authInstructions = null;
            $scope.canSignup = false;
        }
    }

    function saveUandP(username, password){    
        var access_details = {key: 'access', 'username': username, 'password': password};
        var saved_value = $mmMetadb.updateMeta(access_details);
        console.log(saved_value);
    }

    if ($mmLoginHelper.isFixedUrlSet()) {
        // Fixed URL, we need to check if it uses browser SSO login.
        checkSite($scope.siteurl);
    } else {
        siteChecked = true;
    }

    $scope.login = function() {

        $mmApp.closeKeyboard();
        // Get input data.
        var siteurl = $scope.siteurl,
            username = $scope.credentials.username,
            password = $scope.credentials.password;

        if (!siteChecked) {
            // Site wasn't checked (it failed), let's check again.
            return checkSite(siteurl).then(function() {
                if (!$scope.isBrowserSSO) {
                    // Site doesn't use browser SSO, throw app's login again.
                    return $scope.login();
                }
            });
        } else if ($scope.isBrowserSSO) {
            // A previous check determined that browser SSO is needed. Let's check again, maybe site was updated.
            return checkSite(siteurl);
        }

        if (!username) {
            $mmUtil.showErrorModal('mm.login.usernamerequired', true);
            return;
        }
        if (!password) {
            $mmUtil.showErrorModal('mm.login.passwordrequired', true);
            return;
        }

        var modal = $mmUtil.showModalLoading();

        // Start the authentication process.
        return $mmSitesManager.getUserToken(siteurl, username, password).then(function(data) {
            return $mmSitesManager.newSite(data.siteurl, data.token, data.privatetoken).then(function() {
                delete $scope.credentials; // Delete username and password from the scope.
                $ionicHistory.nextViewOptions({disableBack: true});

                if (urlToOpen) {
                    // There's a content link to open.
                    return $mmContentLinksDelegate.getActionsFor(urlToOpen, undefined, username).then(function(actions) {
                        action = $mmContentLinksHelper.getFirstValidAction(actions);
                        if (action && action.sites.length) {
                            // Action should only have 1 site because we're filtering by username.
                            action.action(action.sites[0]);
                        } else {
                            saveUandP(username, password);
                            $mmApicalls.getToken(username, password).then(function(){
                                $mmMetadb.getMeta('token').then(function(response){
                                    $rootScope.token = response.value;
                                    return $mmLoginHelper.goToSiteInitialPage();
                                });
                            });
                        }
                    });
                } else {
                    saveUandP(username, password);
                    $mmApicalls.getToken(username, password).then(function(){
                        $mmMetadb.getMeta('token').then(function(response){
                            $rootScope.token = response.value;
                            return $mmLoginHelper.goToSiteInitialPage();
                        });
                    });
                }
            });
        }).catch(function(error) {
            $mmLoginHelper.treatUserTokenError(siteurl, error);
        }).finally(function() {
            modal.dismiss();
        });
    };

});
