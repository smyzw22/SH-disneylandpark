export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/forecast/index',
    'pages/checkin/index',
    'pages/route/index',
    'pages/history/index',
    'pages/recommend/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#3D5A80',
    navigationBarTitleText: '乐园小助手',
    navigationBarTextStyle: 'white',
    backgroundColor: '#FDF8F1',
  },
  permission: {
    'scope.userLocation': {
      desc: '用于在园区地图上展示周边位置（可选）',
    },
  },
  tabBar: {
    color: '#5C6B7A',
    selectedColor: '#C9956C',
    backgroundColor: '#FDF8F1',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '今日',
        iconPath: 'assets/tab-home.png',
        selectedIconPath: 'assets/tab-home-active.png',
      },
      {
        pagePath: 'pages/forecast/index',
        text: '预测',
        iconPath: 'assets/tab-forecast.png',
        selectedIconPath: 'assets/tab-forecast-active.png',
      },
      {
        pagePath: 'pages/checkin/index',
        text: '打卡',
        iconPath: 'assets/tab-checkin.png',
        selectedIconPath: 'assets/tab-checkin-active.png',
      },
      {
        pagePath: 'pages/route/index',
        text: '路线',
        iconPath: 'assets/tab-route.png',
        selectedIconPath: 'assets/tab-route-active.png',
      },
      {
        pagePath: 'pages/history/index',
        text: '我的',
        iconPath: 'assets/tab-history.png',
        selectedIconPath: 'assets/tab-history-active.png',
      },
    ],
  },
})
