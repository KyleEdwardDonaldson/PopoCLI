using System.Text.Json.Serialization;

namespace DataAccess.Entities
{
    public class CenapredData
    {
        private static Dictionary<DateTime, CenapredData> _cache = new Dictionary<DateTime, CenapredData>();

        [JsonIgnore]
        public int UsageCount { get; set; }

        public string Exhalations { get; set; }

        public string Phase { get; set; }

        public string DirectionOfPlume { get; set; }

        public string MinutesOfTremor { get; set; }

        public string Explosions { get; set; }

        public static CenapredData? TryGetData(DateTime date)
        {
            var timelessDate = date.Date;
            if (_cache.ContainsKey(timelessDate))
            {
                _cache[timelessDate].UsageCount++;
                return _cache[timelessDate];
            }

            var data = CenapredScraper.Scrape(timelessDate);

            if (data != null)
            {
                if (_cache.Count == 7)
                {
                    var leastUsed = _cache.OrderBy(d => d.Value.UsageCount).First().Key;

                    _cache.Remove(leastUsed);
                }

                _cache.Add(timelessDate, data);
            }

            return data;
        }        
    }
}
