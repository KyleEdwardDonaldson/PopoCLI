using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;
using OpenQA.Selenium.Interactions;
using OpenQA.Selenium.Remote;
using OpenQA.Selenium.Support.UI;

namespace DataAccess
{
    public static class SeleniumHelper
    {
        public static ChromeDriver SetupChromeDriver()
        {
            var caps = new ChromeOptions
            {
                
            };
            caps.AddUserProfilePreference("profile.default_content_settings.popups", 0);

            //caps.AddArguments("headless");

            return new ChromeDriver(caps);
        }

        public static void OpenPage(ChromeDriver driver, string page)
        {
            driver.Navigate().GoToUrl(page);
        }

        public static IWebElement WaitUntilElementClickable(this WebDriver driver, By elementLocator, int timeout = 10)
        {
            try
            {
                var wait = new WebDriverWait(driver, TimeSpan.FromSeconds(timeout));
                wait.Until(SeleniumExtras.WaitHelpers.ExpectedConditions.ElementIsVisible(elementLocator));

                return wait.Until(SeleniumExtras.WaitHelpers.ExpectedConditions.ElementToBeClickable(elementLocator));
            }
            catch (NoSuchElementException)
            {
                Console.WriteLine("Element with locator: '" + elementLocator + "' was not found in current context page.");
                throw;
            }
        }
    }
}
